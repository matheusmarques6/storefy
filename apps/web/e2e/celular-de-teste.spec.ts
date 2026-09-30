/**
 * O celular de teste, do QR do painel ao envio de teste (C08).
 *
 * Este teste nasceu de um defeito: o envio de teste listava os dez aparelhos
 * vistos por último — clientes inclusive —, e "testar" mandava uma
 * notificação ainda sem revisão para o celular de um cliente. Agora só o
 * celular que o lojista PAREIA recebe o teste. Aqui a cadeia roda inteira:
 * o painel gera o QR, o "app" (uma chamada assinada, como o app faria) se
 * apresenta com o código, e o painel percebe sozinho.
 */
import { expect, test } from '@playwright/test';
import { MOTIVO_PULO, SUPABASE_DISPONIVEL, bancoDeTeste, limparUsuariosDeTeste } from './apoio';
import { SEGREDO_DO_WORKFLOW, doApp, lojaComApp, postar } from './app-assinado';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.skip(SEGREDO_DO_WORKFLOW === '', 'Defina BUILD_API_SECRET, como o scripts/e2e-local.sh faz.');
test.afterAll(limparUsuariosDeTeste);

const CELULAR_DA_ANA = '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const CELULAR_DO_CLIENTE = '7b2e3d4c-5f6a-4b7c-9d8e-0f1a2b3c4d5e';

test('o lojista pareia o próprio celular pelo QR, testa só nele e o remove', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const { usuario, lojaId, appId, segredo } = await lojaComApp(page, 'celular-teste');

  // Dois aparelhos abriram o app: o da Ana (a lojista) e o de um cliente.
  for (const [instalacao, inscricao] of [
    [CELULAR_DA_ANA, 'inscricao-da-ana'],
    [CELULAR_DO_CLIENTE, 'inscricao-do-cliente'],
  ] as const) {
    const registro = await doApp(page, segredo, '/api/public/devices', {
      appId,
      installId: instalacao,
      subscriptionId: inscricao,
      platform: 'android',
      appVersion: '1.0.3',
    });
    expect(registro.status, JSON.stringify(registro.corpo)).toBeLessThan(300);
  }

  // O cliente NÃO aparece no envio de teste: a caixa começa sem celular nenhum.
  await page.goto('/push/nova');
  const caixa = page.getByTestId('envio-de-teste');
  await expect(caixa.getByText('nunca para um cliente')).toBeVisible();
  await expect(caixa.getByRole('radio')).toHaveCount(0);

  // Sem nome, o QR não sai.
  await caixa.getByRole('button', { name: 'Adicionar meu celular' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Adicionar celular de teste' });
  await dialogo.getByRole('button', { name: 'Mostrar o QR code' }).click();
  await expect(dialogo.getByText('Dê um nome ao celular')).toBeVisible();

  // Enter no nome gera o QR — e não envia a campanha que está em volta.
  await dialogo.getByLabel('Como chamar este celular?').fill('Celular da Ana');
  await dialogo.getByLabel('Como chamar este celular?').press('Enter');
  const qr = dialogo.getByTestId('qr-do-celular-de-teste');
  await expect(qr.locator('svg')).toBeVisible();
  await expect(page).toHaveURL(/\/push\/nova$/);
  const { count: campanhas } = await bancoDeTeste()
    .from('push_campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('app_id', appId);
  expect(campanhas).toBe(0);
  const codigo = (await qr.getAttribute('data-codigo')) ?? '';
  expect(codigo).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  await expect(dialogo.getByText('Esperando o celular')).toBeVisible();
  await expect(dialogo.getByRole('link', { name: 'Toque aqui para abrir o app' })).toHaveAttribute(
    'href',
    `storefy-${lojaId}://celular-de-teste?codigo=${codigo}`,
  );

  // No banco, o código existe só como hash.
  const { data: codigos } = await bancoDeTeste()
    .from('test_device_codes')
    .select('code_hash, nome, used_at')
    .eq('app_id', appId);
  expect(codigos).toHaveLength(1);
  expect(JSON.stringify(codigos)).not.toContain(codigo);

  /*
   * A página que o QR abre, num celular sem login no painel: só a ponte até o
   * app, com o código no fragmento do link.
   */
  const celular = await browser.newContext({ baseURL: page.url() });
  const pagina = await celular.newPage();
  await pagina.goto(`/celular-de-teste#loja=${lojaId}&codigo=${codigo}`);
  await expect(pagina.getByRole('link', { name: 'Abrir o app da loja' })).toHaveAttribute(
    'href',
    `storefy-${lojaId}://celular-de-teste?codigo=${codigo}`,
  );
  await pagina.goto(`/celular-de-teste#loja=${lojaId}&codigo=ERRADO`);
  await pagina.reload();
  await expect(pagina.getByText('Este link está incompleto')).toBeVisible();
  await expect(pagina.getByRole('link', { name: 'Abrir o app da loja' })).toHaveCount(0);
  await celular.close();

  // O app, sem a assinatura, não pareia nada.
  const semAssinatura = await postar(
    page,
    '/api/public/test-device',
    JSON.stringify({ appId, codigo, installId: CELULAR_DA_ANA }),
    {},
  );
  expect(semAssinatura.status).toBe(401);

  // Código errado: o app recebe o resultado, para explicar ao lojista.
  const errado = await doApp(page, segredo, '/api/public/test-device', {
    appId,
    codigo: 'ZZZZ2345',
    installId: CELULAR_DA_ANA,
  });
  expect(errado).toEqual({ status: 200, corpo: { resultado: 'codigo_invalido' } });

  // O app da Ana, aberto pelo QR, se apresenta com o código (digitado em minúsculas).
  const pareado = await doApp(page, segredo, '/api/public/test-device', {
    appId,
    codigo: codigo.toLowerCase(),
    installId: CELULAR_DA_ANA,
    subscriptionId: 'inscricao-da-ana',
  });
  expect(pareado).toEqual({ status: 200, corpo: { resultado: 'pareado' } });

  // O painel percebe sozinho: o diálogo fecha e a Ana aparece — só ela.
  await expect(page.getByText('Celular da Ana foi adicionado')).toBeVisible({ timeout: 15_000 });
  await expect(dialogo).toBeHidden();
  await expect(caixa.getByRole('radio')).toHaveCount(1);
  await expect(caixa.getByText('Celular da Ana')).toBeVisible();
  await expect(caixa.getByText('Android · versão 1.0.3 · visto agora')).toBeVisible();

  // O código é de uso único.
  const deNovo = await doApp(page, segredo, '/api/public/test-device', {
    appId,
    codigo,
    installId: CELULAR_DO_CLIENTE,
  });
  expect(deNovo.corpo).toEqual({ resultado: 'codigo_invalido' });

  // Recarregar a página traz o mesmo celular, do banco.
  await page.reload();
  await expect(caixa.getByRole('radio', { name: /Celular da Ana/ })).toBeChecked();

  /*
   * O teste chega até a entrega: sem as notificações ligadas nesta loja, é
   * isso que a tela diz — o celular foi aceito como destino.
   */
  await page.getByLabel('Título', { exact: true }).fill('Teste do celular');
  await page.getByLabel('Mensagem', { exact: true }).fill('Chegou só para mim?');
  await caixa.getByRole('button', { name: 'Enviar teste' }).click();
  await expect(
    page.getByText('Esta loja ainda não tem as notificações configuradas.'),
  ).toBeVisible();

  // Parear e remover ficam na trilha, com o nome de quem fez.
  const { data: celulares } = await bancoDeTeste()
    .from('test_devices')
    .select('id')
    .eq('app_id', appId);
  expect(celulares).toHaveLength(1);

  // Remover pede confirmação; cancelar não remove.
  await caixa.getByRole('button', { name: 'Remover Celular da Ana' }).click();
  const confirmacao = page.getByRole('alertdialog', { name: /Remover “Celular da Ana”\?/ });
  await confirmacao.getByRole('button', { name: 'Cancelar' }).click();
  await expect(caixa.getByRole('radio')).toHaveCount(1);

  await caixa.getByRole('button', { name: 'Remover Celular da Ana' }).click();
  await confirmacao.getByRole('button', { name: 'Remover' }).click();
  await expect(page.getByText('Celular da Ana não recebe mais os testes.')).toBeVisible();
  await expect(caixa.getByRole('radio')).toHaveCount(0);
  await expect(caixa.getByRole('button', { name: 'Adicionar meu celular' })).toBeVisible();

  const { count: restantes } = await bancoDeTeste()
    .from('test_devices')
    .select('id', { count: 'exact', head: true })
    .eq('app_id', appId);
  expect(restantes).toBe(0);

  const { data: trilha } = await bancoDeTeste()
    .from('audit_logs')
    .select('action, actor_id, entity_id')
    .eq('entity', 'test_devices')
    .eq('entity_id', celulares?.[0]?.id ?? '')
    .order('created_at');
  expect(trilha).toEqual([
    { action: 'create', actor_id: usuario, entity_id: celulares?.[0]?.id },
    { action: 'delete', actor_id: usuario, entity_id: celulares?.[0]?.id },
  ]);
});

test('o código do QR vence em 10 minutos, e o painel oferece outro', async ({ page }) => {
  test.setTimeout(120_000);
  const { appId, segredo } = await lojaComApp(page, 'codigo-vencido');
  await doApp(page, segredo, '/api/public/devices', {
    appId,
    installId: CELULAR_DA_ANA,
    platform: 'ios',
  });

  // O relógio do navegador anda sozinho daqui: dá para pular dez minutos.
  await page.clock.install();
  await page.goto('/push/nova');
  const caixa = page.getByTestId('envio-de-teste');
  await caixa.getByRole('button', { name: 'Adicionar meu celular' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Adicionar celular de teste' });
  await dialogo.getByLabel('Como chamar este celular?').fill('iPhone do caixa');
  await dialogo.getByRole('button', { name: 'Mostrar o QR code' }).click();
  await expect(dialogo.getByTestId('qr-do-celular-de-teste')).toBeVisible();

  await page.clock.fastForward('11:00');
  await expect(dialogo.getByText('Este código venceu.')).toBeVisible();
  await expect(dialogo.getByTestId('qr-do-celular-de-teste')).toHaveCount(0);

  // O código novo sai na hora, e o app pareia com ele (sem push: só pela instalação).
  await dialogo.getByRole('button', { name: 'Gerar outro código' }).click();
  const qr = dialogo.getByTestId('qr-do-celular-de-teste');
  await expect(qr).toBeVisible();
  const codigo = (await qr.getAttribute('data-codigo')) ?? '';
  const pareado = await doApp(page, segredo, '/api/public/test-device', {
    appId,
    codigo,
    installId: CELULAR_DA_ANA,
  });
  expect(pareado.corpo).toEqual({ resultado: 'pareado' });

  await page.clock.fastForward('00:05');
  await expect(page.getByText('iPhone do caixa foi adicionado')).toBeVisible({ timeout: 15_000 });
  // Pareado sem push: está na lista, e a tela diz por que o teste ainda não chega.
  await expect(caixa.getByText('Ainda não recebe notificações')).toBeVisible();
});

/**
 * Os números das automações (C09, C10 e C11) e o total do C07.
 *
 * Este teste nasceu da auditoria: a automação mostrava só quantas
 * notificações saíram e o que venderam — sem aberturas, sem funil, sem tela de
 * detalhe —, e o C07 somava o "total" só das 50 campanhas que lia, sem deixar
 * ver as mais antigas. Aqui a cadeia roda inteira: os envios gravados como o
 * despachante os grava, o toque contado pelo "app" (uma chamada assinada, como
 * o app faria) e as telas lendo tudo do banco.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from './base';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  bancoDeTeste,
  criarLojaPelaTela,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
} from './apoio';
import { varrer } from './axe';
import { SEGREDO_DO_WORKFLOW, doApp, lojaComApp, postar } from './app-assinado';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

test('a automação conta as aberturas pelo app, e o detalhe mostra o funil e o que não saiu', async ({
  page,
}) => {
  test.skip(
    SEGREDO_DO_WORKFLOW === '',
    'Defina BUILD_API_SECRET, como o scripts/e2e-local.sh faz.',
  );
  test.setTimeout(120_000);
  const { appId, segredo } = await lojaComApp(page, 'numeros-automacao');

  // O lojista liga o carrinho abandonado pela tela.
  await page.goto('/push/automacoes');
  await page.getByRole('switch', { name: 'Ligar Carrinho abandonado' }).click();
  await expect(page.getByRole('switch', { name: 'Desligar Carrinho abandonado' })).toBeVisible();

  const { data: automacao } = await bancoDeTeste()
    .from('push_automations')
    .select('id')
    .eq('app_id', appId)
    .eq('type', 'abandoned_cart')
    .single();
  if (automacao == null) throw new Error('A automação ligada pela tela não foi gravada.');

  // Um cliente com o app, registrado como o app registra.
  const instalacao = randomUUID();
  const registro = await doApp(page, segredo, '/api/public/devices', {
    appId,
    installId: instalacao,
    subscriptionId: 'inscricao-dos-numeros',
    platform: 'android',
  });
  expect(registro.status, JSON.stringify(registro.corpo)).toBeLessThan(300);
  const { data: aparelho } = await bancoDeTeste()
    .from('devices')
    .select('id')
    .eq('app_id', appId)
    .eq('install_id', instalacao)
    .single();
  if (aparelho == null) throw new Error('O aparelho não foi registrado.');

  /*
   * Os envios como o despachante os deixa: três que saíram, um cancelado
   * porque o cliente comprou, um que a OneSignal recusou (em inglês) e um
   * esperando a hora.
   */
  const umaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const envios = [randomUUID(), randomUUID(), randomUUID()];
  const { error: erroDosEnvios } = await bancoDeTeste()
    .from('automation_runs')
    .insert([
      ...envios.map((id) => ({
        id,
        automation_id: automacao.id,
        device_id: aparelho.id,
        status: 'sent' as const,
        scheduled_for: umaHora,
        sent_at: umaHora,
      })),
      {
        id: randomUUID(),
        automation_id: automacao.id,
        device_id: aparelho.id,
        status: 'canceled' as const,
        scheduled_for: umaHora,
        canceled_reason: 'compra concluída',
      },
      {
        id: randomUUID(),
        automation_id: automacao.id,
        device_id: aparelho.id,
        status: 'failed' as const,
        scheduled_for: umaHora,
        canceled_reason: 'All included players are not subscribed',
      },
      {
        id: randomUUID(),
        automation_id: automacao.id,
        device_id: aparelho.id,
        status: 'scheduled' as const,
        scheduled_for: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    ]);
  if (erroDosEnvios != null) throw new Error(erroDosEnvios.message);

  // Antes do primeiro toque contado, a abertura é traço — e não zero.
  await page.reload();
  const cartao = page.getByRole('region', { name: 'Carrinho abandonado' });
  await expect(
    cartao.getByText('Enviadas', { exact: true }).locator('..').getByRole('definition'),
  ).toHaveText('3');
  await expect(
    cartao.getByText('Aberturas', { exact: true }).locator('..').getByRole('definition'),
  ).toHaveText('—');
  await expect(cartao.getByText('próxima versão do app')).toBeVisible();

  // O toque, sem a assinatura do app, não conta nada.
  const semAssinatura = await postar(
    page,
    '/api/public/push-opened',
    JSON.stringify({ appId, envio: envios[0] }),
    {},
  );
  expect(semAssinatura.status).toBe(401);

  // O app conta o toque; o mesmo toque de novo não soma; um envio inventado não conta.
  for (const [envio, contada] of [
    [envios[0], true],
    [envios[0], true],
    [randomUUID(), false],
  ] as const) {
    const toque = await doApp(page, segredo, '/api/public/push-opened', { appId, envio });
    expect(toque, String(envio)).toEqual({ status: 200, corpo: { contada } });
  }
  const { count: abertos } = await bancoDeTeste()
    .from('automation_runs')
    .select('id', { count: 'exact', head: true })
    .eq('automation_id', automacao.id)
    .not('opened_at', 'is', null);
  expect(abertos).toBe(1);

  await page.reload();
  await expect(
    cartao.getByText('Aberturas', { exact: true }).locator('..').getByRole('definition'),
  ).toHaveText('1 · 33,3%');

  // O detalhe (C10): o funil do período e o que não saiu, em português.
  await cartao.getByRole('link', { name: 'Ver detalhes' }).click();
  await expect(page).toHaveURL(new RegExp(`/push/automacoes/${automacao.id}$`));
  await expect(page.getByRole('heading', { name: 'Carrinho abandonado' })).toBeVisible();
  await expect(page.getByTestId('funil-enviados')).toHaveText('3');
  await expect(page.getByTestId('funil-aberturas')).toHaveText('1');
  const naoSairam = page.getByRole('list', { name: 'Envios que não saíram' });
  await expect(naoSairam.getByRole('listitem')).toHaveCount(3);
  await expect(naoSairam).toContainText('Não saíram porque o cliente comprou antes');
  await expect(naoSairam).toContainText(
    'Não saíram porque o aparelho não recebe mais notificações',
  );
  await expect(naoSairam).toContainText('Esperando a hora de sair');
  await varrer(page, 'C10 da automação com o funil');
  await expect(page.getByText('not subscribed')).toHaveCount(0);

  // O período vai na URL.
  await page.getByRole('link', { name: '7 dias' }).click();
  await expect(page).toHaveURL(/periodo=7$/);
  await expect(page.getByTestId('funil-enviados')).toHaveText('3');

  /*
   * Desligar cancela o que estava na fila, e a tela diz por quê: ligar de novo
   * semanas depois não manda o lembrete de um carrinho antigo.
   */
  await page.goto('/push/automacoes');
  await page.getByRole('switch', { name: 'Desligar Carrinho abandonado' }).click();
  await expect(page.getByRole('switch', { name: 'Ligar Carrinho abandonado' })).toBeVisible();
  /*
   * A chave vira na tela antes de a gravação terminar. Sair da página antes
   * faria o detalhe ler a automação de antes e os envios de depois.
   */
  await expect
    .poll(async () => {
      const { data } = await bancoDeTeste()
        .from('push_automations')
        .select('enabled')
        .eq('id', automacao.id)
        .single();
      return data?.enabled;
    })
    .toBe(false);
  await page.goto(`/push/automacoes/${automacao.id}`);
  await expect(page.getByText('Desligada', { exact: true })).toBeVisible();
  await expect(naoSairam).toContainText('Não saíram porque a automação foi desligada');
  await expect(naoSairam).not.toContainText('Esperando a hora de sair');
  const { count: naFila } = await bancoDeTeste()
    .from('automation_runs')
    .select('id', { count: 'exact', head: true })
    .eq('automation_id', automacao.id)
    .eq('status', 'scheduled');
  expect(naFila).toBe(0);

  /*
   * Um id que não é desta loja não abre nada. É a página de "não encontrada"
   * (com status 200: o painel já começou a responder quando a checagem roda,
   * e o Next marca a página como `noindex`).
   */
  for (const caminho of [`/push/automacoes/${randomUUID()}`, '/push/automacoes/nao-e-um-id']) {
    await page.goto(caminho);
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
  }
});

test('o C07 pagina as campanhas, e o total do topo conta todas', async ({ page }) => {
  test.setTimeout(120_000);
  const email = emailDeTeste('c07-paginado');
  await criarUsuarioConfirmado(email, 'Empresa Paginada');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Paginada', 'loja-paginada.com.br');
  const { data: app } = await bancoDeTeste()
    .from('apps')
    .select('id')
    .eq('store_id', lojaId)
    .single();
  if (app == null) throw new Error('A loja criada pela tela ficou sem app.');

  /*
   * Vinte e três campanhas, como o job as deixa: vinte e duas enviadas, com
   * dez entregues cada, e um rascunho. A lista mostra vinte por página.
   */
  const base = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const { error } = await bancoDeTeste()
    .from('push_campaigns')
    .insert(
      Array.from({ length: 23 }, (_, indice) => ({
        app_id: app.id,
        title: `Campanha ${String(indice + 1).padStart(2, '0')}`,
        body: 'Texto da campanha',
        status: indice === 22 ? ('draft' as const) : ('sent' as const),
        sent_at: indice === 22 ? null : new Date(base + indice * 60_000).toISOString(),
        created_at: new Date(base + indice * 60_000).toISOString(),
        stats: indice === 22 ? {} : { enviados: 12, entregues: 10, abertos: 3 },
      })),
    );
  if (error != null) throw new Error(error.message);

  await page.goto('/push');
  await expect(page.getByText('Campanhas enviadas').locator('..')).toContainText('22');
  await expect(page.getByText('Notificações entregues').locator('..')).toContainText('220');

  const lista = page.getByRole('list', { name: 'Campanhas' });
  await expect(lista.getByRole('listitem')).toHaveCount(20);
  // As mais novas primeiro: o rascunho é a mais nova.
  await expect(lista.getByRole('listitem').first()).toContainText('Campanha 23');
  await varrer(page, 'C07 paginado');
  await expect(page.getByText('Página 1 de 2 · 23 resultados')).toBeVisible();

  await page.getByRole('link', { name: 'Próxima' }).click();
  await expect(page).toHaveURL(/\/push\?pagina=2$/);
  await expect(lista.getByRole('listitem')).toHaveCount(3);
  await expect(lista.getByRole('listitem').last()).toContainText('Campanha 01');
  // O total continua sendo o de todas, e não o da página.
  await expect(page.getByText('Campanhas enviadas').locator('..')).toContainText('22');

  // Um link para uma página que já não existe volta ao começo, sem tela de erro.
  await page.goto('/push?pagina=9');
  await expect(page).toHaveURL(/\/push$/);
  await expect(lista.getByRole('listitem')).toHaveCount(20);
});

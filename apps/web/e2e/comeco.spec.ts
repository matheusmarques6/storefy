/**
 * O começo guiado de uma loja (C02 → C03 → C04) e o checklist do painel (C05).
 *
 * Este teste nasceu de uma lacuna: o plano pedia três passos — a URL, o visual
 * rápido com a prévia ao vivo e o app no celular com o "tudo pronto" —, e o
 * cadastro caía direto na página da loja. Os links do Storefy Preview vêm da
 * A13; sem eles, a tela diz que o app ainda não está disponível.
 */
import { expect, test } from '@playwright/test';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  bancoDeTeste,
  criarLojaPelaTela,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
  tornarPlatformAdmin,
} from './apoio';
import { varrer } from './axe';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);

const equipeDeTeste: string[] = [];

test.afterAll(async () => {
  // As chaves da plataforma são globais: o teste devolve o padrão.
  await bancoDeTeste()
    .from('platform_settings')
    .delete()
    .in('chave', ['previa_no_iphone', 'previa_no_android']);
  if (equipeDeTeste.length > 0) {
    await bancoDeTeste().from('audit_logs').delete().in('actor_id', equipeDeTeste);
  }
  await limparUsuariosDeTeste();
});

async function rascunhoDa(lojaId: string) {
  const { data: app } = await bancoDeTeste()
    .from('apps')
    .select('id')
    .eq('store_id', lojaId)
    .single();
  const { data, error } = await bancoDeTeste()
    .from('app_configs')
    .select('config, status')
    .eq('app_id', app?.id ?? '')
    .order('version', { ascending: false });
  if (error != null) throw new Error(error.message);
  return data;
}

test('cadastro, visual rápido, o app no celular e o checklist até o app ir ao ar', async ({
  page,
  browser,
}) => {
  const email = emailDeTeste('comeco');
  await criarUsuarioConfirmado(email, 'Empresa Começo');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja do Começo', 'loja-do-comeco.com.br');

  // C03: o passo 2 de 3, com a loja que acabou de nascer.
  await expect(page.getByRole('heading', { name: 'Confira o visual do seu app' })).toBeVisible();
  await expect(page.getByText('Loja criada:')).toBeVisible();
  await expect(
    page
      .getByRole('list', { name: 'Passos para começar' })
      .getByRole('listitem')
      .filter({ hasText: 'Visual do app' }),
  ).toHaveAttribute('aria-current', 'step');

  // A cor da marca e as abas, com o mínimo de duas travado na tela.
  await page.getByRole('textbox', { name: 'Cor principal', exact: true }).fill('#1d4ed8');
  await page.getByRole('switch', { name: 'Tirar a aba Buscar' }).click();
  await page.getByRole('switch', { name: 'Tirar a aba Carrinho' }).click();
  await expect(page.getByRole('switch', { name: 'Tirar a aba Início' })).toBeDisabled();
  await expect(page.getByRole('switch', { name: 'Tirar a aba Conta' })).toBeDisabled();
  await page.getByRole('switch', { name: 'Mostrar a aba Carrinho' }).click();

  await page.getByRole('button', { name: 'Salvar e continuar' }).click();
  await page.waitForURL(`**/lojas/${lojaId}/comecar/pronto`);

  // O rascunho guardou a cor e as abas, na ordem sugerida; nada foi ao ar.
  const configs = await rascunhoDa(lojaId);
  expect(configs.map((linha) => linha.status)).toEqual(['draft']);
  const config = configs[0]?.config as {
    theme: { primary: string; tabBarActive: string };
    tabs: { id: string }[];
  };
  expect(config.theme.primary).toBe('#1d4ed8');
  expect(config.theme.tabBarActive).toBe('#1d4ed8');
  expect(config.tabs.map((aba) => aba.id)).toEqual(['inicio', 'carrinho', 'conta']);

  // C04: sem o Storefy Preview publicado, a tela diz isso — e o código sai.
  await expect(
    page.getByRole('heading', { name: 'Tudo pronto para ver no celular' }),
  ).toBeVisible();
  await expect(
    page.getByText('O app Storefy Preview ainda não está disponível para baixar.', {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Gerar código' }).click();
  await expect(page.getByRole('img', { name: 'Código QR da prévia' })).toBeVisible();
  await varrer(page, 'C04 com o QR da prévia');

  // O checklist com o estado de verdade: só o cadastro feito.
  await expect(page.getByText('1 de 7 passos feitos.', { exact: false })).toBeVisible();
  await expect(page.getByText('Falta: Ícone e tela de abertura')).toBeVisible();
  await expect(page.getByText('Feito: Loja cadastrada')).toBeVisible();

  // O painel guarda o mesmo checklist até o app ser aprovado.
  await page.getByRole('link', { name: 'Ir para o painel' }).click();
  const primeiros = page.getByRole('region', { name: 'Primeiros passos de Loja do Começo' });
  await expect(primeiros.getByText('1 de 7')).toBeVisible();
  await expect(primeiros.getByRole('link', { name: 'Publicar no editor' })).toBeVisible();
  await varrer(page, 'o início com os primeiros passos');

  // Pular não grava nada: a segunda loja segue com o rascunho de nascença.
  const outraId = await criarLojaPelaTela(page, 'Loja Pulada', 'loja-pulada.com.br');
  const antes = await rascunhoDa(outraId);
  await page.getByRole('link', { name: 'Pular por agora' }).click();
  await page.waitForURL(`**/lojas/${outraId}/comecar/pronto`);
  expect(await rascunhoDa(outraId)).toEqual(antes);

  // O C04 da primeira loja, com a segunda ativa, avisa antes de mandar para o lugar errado.
  await page.goto(`/lojas/${lojaId}/comecar/pronto`);
  await expect(
    page.getByText('O painel está mostrando outra loja.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Usar Loja do Começo no painel' }).click();
  await expect(page.getByText('Agora o painel mostra Loja do Começo.')).toBeVisible();
  await expect(page.getByText('O painel está mostrando outra loja.', { exact: false })).toHaveCount(
    0,
  );

  // A equipe publica os links do Storefy Preview na A13, e o C04 passa a oferecê-los.
  const equipe = await (await browser.newContext()).newPage();
  const emailDaEquipe = emailDeTeste('comeco-equipe');
  const idDaEquipe = await criarUsuarioConfirmado(emailDaEquipe, 'Equipe Storefy');
  equipeDeTeste.push(idDaEquipe);
  await tornarPlatformAdmin(idDaEquipe);
  await entrar(equipe, emailDaEquipe);
  await equipe.goto('/admin/sistema');
  await equipe.waitForLoadState('networkidle');

  // Link da loja errada é recusado, dizendo qual campo.
  await equipe
    .getByLabel('Link para iPhone (App Store ou TestFlight)')
    .fill('https://play.google.com/store/apps/details?id=br.storefy.preview');
  await equipe.getByRole('button', { name: 'Salvar chaves' }).click();
  await expect(equipe.locator('form').getByRole('alert')).toContainText(
    'O link do iPhone precisa ser da App Store',
  );

  await equipe
    .getByLabel('Link para iPhone (App Store ou TestFlight)')
    .fill('https://apps.apple.com/br/app/storefy-preview/id6400000000');
  await equipe
    .getByLabel('Link para Android (Google Play)')
    .fill('https://play.google.com/store/apps/details?id=br.storefy.preview');
  await equipe.getByRole('button', { name: 'Salvar chaves' }).click();
  await expect(equipe.getByText('Chaves salvas.')).toBeVisible();

  const { data: trilha } = await bancoDeTeste()
    .from('audit_logs')
    .select('diff')
    .eq('entity', 'platform_settings')
    .eq('actor_id', idDaEquipe);
  expect(JSON.stringify(trilha)).toContain('previa_no_iphone');
  expect(JSON.stringify(trilha)).toContain('previa_no_android');

  await page.reload();
  await expect(page.getByRole('link', { name: 'Baixar para iPhone' })).toHaveAttribute(
    'href',
    'https://apps.apple.com/br/app/storefy-preview/id6400000000',
  );
  await expect(page.getByRole('link', { name: 'Baixar para Android' })).toHaveAttribute(
    'href',
    'https://play.google.com/store/apps/details?id=br.storefy.preview',
  );
});

test('quem é membro vê o visual e o checklist, mas não muda nem gera código', async ({ page }) => {
  const dono = emailDeTeste('comeco-dono');
  await criarUsuarioConfirmado(dono, 'Empresa Começo Membro');
  await entrar(page, dono);
  const lojaId = await criarLojaPelaTela(page, 'Loja do Membro', 'loja-do-membro.com.br');

  const membro = emailDeTeste('comeco-membro');
  const membroId = await criarUsuarioConfirmado(membro, 'Pessoal Membro');
  const { data: loja } = await bancoDeTeste()
    .from('stores')
    .select('org_id')
    .eq('id', lojaId)
    .single();
  const { error } = await bancoDeTeste()
    .from('memberships')
    .insert({ org_id: loja?.org_id ?? '', user_id: membroId, role: 'member' });
  if (error != null) throw new Error(error.message);

  await page.context().clearCookies();
  await entrar(page, membro);
  await page.goto(`/lojas/${lojaId}/comecar`);
  await expect(
    page.getByText('Só proprietários e administradores mudam o visual do app.'),
  ).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Tirar a aba Buscar' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Salvar e continuar' })).toHaveCount(0);
  // Nem monta o ícone a partir do logo do site.
  await expect(page.getByRole('button', { name: 'Usar o logo do site' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Continuar' }).click();
  await page.waitForURL(`**/lojas/${lojaId}/comecar/pronto`);
  await expect(
    page.getByText('O código da prévia no celular é gerado por proprietários e administradores.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gerar código' })).toHaveCount(0);
  await expect(page.getByText('Falta: Ícone e tela de abertura')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Enviar no editor' })).toHaveCount(0);
});

/*
 * "Usar o logo do site" relê a página da loja no servidor. O endereço deste
 * teste não existe na internet — e é o caminho que precisa estar certo na
 * tela: o botão espera, diz o motivo embaixo do campo, e o ícone não muda. O
 * caminho do logo que dá certo está no teste de unidade (`logo-do-site`),
 * com imagens de verdade, porque o servidor do teste não sai para a internet.
 */
test('usar o logo do site: com o site fora do ar, diz o motivo e não muda o ícone', async ({
  page,
}) => {
  const email = emailDeTeste('comeco-logo');
  await criarUsuarioConfirmado(email, 'Empresa Logo');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(
    page,
    'Loja do Logo',
    `loja-que-nao-existe-${String(Date.now())}.com.br`,
  );

  const botao = page.getByRole('button', { name: 'Usar o logo do site' });
  await expect(botao).toBeVisible();
  await botao.click();

  await expect(
    page.getByText('Não conseguimos acessar a loja agora. Confira o endereço ou preencha à mão.'),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Usar o logo do site' })).toBeEnabled();

  const { data: app } = await bancoDeTeste()
    .from('apps')
    .select('icon_path')
    .eq('store_id', lojaId)
    .single();
  expect(app?.icon_path).toBeNull();
});

/*
 * A pasta da loja tem `loading.tsx`: a página vai por streaming, e o status já
 * saiu quando o `notFound()` acontece. O que o visitante vê é a tela de "não
 * encontrada" — é ela que o teste confere, como o de isolamento.
 */
test('endereço de começo que não é de loja nenhuma é "não encontrada"', async ({ page }) => {
  const email = emailDeTeste('comeco-404');
  await criarUsuarioConfirmado(email, 'Empresa 404');
  await entrar(page, email);

  for (const caminho of [
    '/lojas/nao-e-uuid/comecar',
    `/lojas/${crypto.randomUUID()}/comecar`,
    `/lojas/${crypto.randomUUID()}/comecar/pronto`,
  ]) {
    await page.goto(caminho);
    await expect(page.getByText('Página não encontrada'), caminho).toBeVisible();
  }
});

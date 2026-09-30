/**
 * C12 — o último passo para o app ir ao ar, de ponta a ponta.
 *
 * O estado de cada versão na loja de aplicativos vem do job da revisão, que
 * pergunta à Apple e à Google de hora em hora. Aqui o teste grava direto o
 * que o job gravaria (a Apple e a Google não respondem daqui) e confere o que
 * o lojista, o painel inicial e a equipe (A06) leem disso.
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

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

async function appDaLoja(lojaId: string): Promise<string> {
  const { data, error } = await bancoDeTeste()
    .from('apps')
    .select('id')
    .eq('store_id', lojaId)
    .single();
  if (error != null) throw new Error(error.message);
  return data.id;
}

async function mudarBuild(
  id: string,
  mudanca: { status: 'submitted' | 'in_review' | 'approved'; store_state: string },
): Promise<void> {
  const { error } = await bancoDeTeste().from('builds').update(mudanca).eq('id', id);
  if (error != null) throw new Error(error.message);
}

test('a vez do lojista aparece no alto da Publicação, e some quando a loja assume', async ({
  page,
}) => {
  const email = emailDeTeste('ultimo-passo');
  await criarUsuarioConfirmado(email, 'Empresa Último Passo');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Último Passo', 'loja-ultimo-passo-e2e.com.br');
  const appId = await appDaLoja(lojaId);

  const banco = bancoDeTeste();
  await banco.from('apps').update({ ios_asc_app_id: '6478123456' }).eq('id', appId);
  const { data: builds, error } = await banco
    .from('builds')
    .insert([
      {
        app_id: appId,
        platform: 'ios',
        status: 'submitted',
        version: '1.0.2',
        build_number: 2,
        submitted_at: new Date().toISOString(),
        store_state: 'PREPARE_FOR_SUBMISSION',
      },
      {
        app_id: appId,
        platform: 'android',
        status: 'submitted',
        version: '1.0.3',
        build_number: 3,
        submitted_at: new Date().toISOString(),
        store_state: 'PLAY_INTERNAL',
      },
    ])
    .select('id, platform');
  if (error != null) throw new Error(error.message);
  const idDo = (plataforma: 'ios' | 'android') =>
    builds.find((build) => build.platform === plataforma)?.id ?? '';

  await page.goto('/publicacao');
  await page.waitForLoadState('networkidle');

  // A Apple: o binário chegou, e ninguém o mandou para a revisão.
  const vez = page.getByRole('region', { name: 'Falta um passo seu' });
  const apple = page.getByTestId('ultimo-passo-ios');
  await expect(vez).toBeVisible();
  await expect(apple).toContainText('Falta você enviar para a revisão da Apple');
  await expect(apple).toContainText('escolha a versão 1.0.2 (2)');
  await expect(apple.getByRole('link', { name: 'Abrir na App Store Connect' })).toHaveAttribute(
    'href',
    'https://appstoreconnect.apple.com/apps/6478123456/distribution',
  );

  // O Google: no teste interno, falta publicar em produção.
  const google = page.getByTestId('ultimo-passo-android');
  await expect(google).toContainText('Falta você publicar em produção no Google Play');
  await expect(google).toContainText('escolha a versão 1.0.3 (3)');

  // O histórico diz a mesma coisa, e não mais "aguardar a revisão".
  await expect(
    page.getByText('Chegou à App Store Connect. Falta você enviar para a revisão da Apple.'),
  ).toBeVisible();
  await expect(
    page.getByText('Está no teste interno da Play Store. Falta você publicar em produção.'),
  ).toBeVisible();
  await expect(page.getByText('Agora é aguardar a revisão')).toHaveCount(0);

  // O painel inicial manda fazer o passo, e não esperar.
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('link', { name: 'Fazer o último passo' })).toBeVisible();

  // O lojista mandou: a Apple está revisando. O cartão da Apple sai; o do Google fica.
  await mudarBuild(idDo('ios'), { status: 'in_review', store_state: 'IN_REVIEW' });
  await page.goto('/publicacao');
  await page.waitForLoadState('networkidle');
  await expect(apple).toHaveCount(0);
  await expect(google).toBeVisible();
  await expect(page.getByText('Alguém da Apple está analisando o app.')).toBeVisible();

  // Publicado em produção e aberto na Play Store: nada mais é a vez dele.
  await mudarBuild(idDo('android'), { status: 'in_review', store_state: 'PLAY_PRODUCTION' });
  await mudarBuild(idDo('android'), { status: 'approved', store_state: 'PLAY_LIVE' });
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(vez).toHaveCount(0);
  await expect(
    page.getByText('Em produção na Play Store, aberto para os clientes baixarem.'),
  ).toBeVisible();

  // E a loja está no ar — o status segue os builds.
  const { data: loja } = await banco.from('stores').select('status').eq('id', lojaId).single();
  expect(loja?.status).toBe('live');
});

test('A06: a equipe vê que a vez é do lojista, e não "esperar a Apple"', async ({
  browser,
  page,
}) => {
  const lojista = await (await browser.newContext()).newPage();
  const email = emailDeTeste('ultimo-passo-a06');
  await criarUsuarioConfirmado(email, 'Empresa A06 Último Passo');
  await entrar(lojista, email);
  const lojaId = await criarLojaPelaTela(lojista, 'Loja A06 Passo', 'loja-a06-passo-e2e.com.br');
  const appId = await appDaLoja(lojaId);

  const { error } = await bancoDeTeste().from('builds').insert({
    app_id: appId,
    platform: 'ios',
    status: 'submitted',
    version: '1.0.4',
    build_number: 4,
    // Mais antigo que qualquer outro da fila: a A06 ordena por quem espera há mais tempo.
    submitted_at: '2020-01-01T12:00:00.000Z',
    store_state: 'PREPARE_FOR_SUBMISSION',
  });
  if (error != null) throw new Error(error.message);

  const equipe = emailDeTeste('ultimo-passo-equipe');
  const idDaEquipe = await criarUsuarioConfirmado(equipe, 'Equipe Último Passo');
  await tornarPlatformAdmin(idDaEquipe, 'support');
  await entrar(page, equipe);
  await page.goto('/admin/revisoes');
  await page.waitForLoadState('networkidle');

  const linha = page.getByRole('row').filter({ hasText: 'Loja A06 Passo' });
  await expect(linha).toContainText('Não enviado para a revisão');
  await expect(linha).toContainText('Lojista enviar para a revisão');
  await expect(linha).not.toContainText('Esperar a Apple');
});

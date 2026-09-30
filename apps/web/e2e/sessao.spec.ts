/**
 * A sessão que acaba no meio do uso (regra 4c: "sessão expirada").
 *
 * A pessoa sai da conta em outra aba, ou troca a senha em outro aparelho, e
 * continua mexendo na tela que já estava aberta. Antes, a ação seguinte
 * recebia o redirect do `proxy`, o navegador repetia o POST no login, e a tela
 * quebrava com "An unexpected response was received from the server" — em
 * inglês, com o que ela digitou perdido; o editor dizia "sem conexão" para
 * sempre. Agora a tela vai ao login, que diz o que houve, e depois da senha
 * volta à tela em que ela estava.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  MOTIVO_PULO,
  SENHA_PADRAO,
  SUPABASE_DISPONIVEL,
  criarLojaPelaTela,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
  tornarPlatformAdmin,
} from './apoio';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

const RECADO = /Sua sessão terminou\. Entre de novo para voltar à tela em que você estava/;

/** Sai da conta em outra aba do mesmo navegador, pelo menu, como a pessoa faria. */
async function sairEmOutraAba(contexto: BrowserContext): Promise<void> {
  const outra = await contexto.newPage();
  await outra.goto('/');
  await outra.getByRole('button', { name: 'Menu da conta' }).click();
  await outra.getByRole('menuitem', { name: 'Sair' }).click();
  await outra.waitForURL(/\/entrar/);
  await outra.close();
}

async function entrarDeNovo(page: Page, email: string): Promise<void> {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA_PADRAO);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

/**
 * A sessão que o servidor não aceita mais, com o cookie ainda no navegador — o
 * que sobra depois de trocar a senha em outro aparelho.
 */
async function invalidarASessao(contexto: BrowserContext): Promise<void> {
  const cookies = await contexto.cookies();
  const daSessao = cookies.filter(({ name }) => /^sb-.+-auth-token(\.\d+)?$/.test(name));
  expect(daSessao.length).toBeGreaterThan(0);
  await contexto.addCookies(
    daSessao.map((cookie) => ({ ...cookie, value: 'base64-bm8tbG9uZ2VyLXZhbGlk' })),
  );
}

test('o formulário e o editor, com a sessão encerrada em outra aba, levam ao login que explica e volta', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const email = emailDeTeste('sessao');
  await criarUsuarioConfirmado(email, 'Empresa Sessão');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Sessão', 'loja-sessao.com.br');

  // Um formulário (os dados da loja), salvo depois de sair em outra aba.
  await page.goto(`/lojas/${lojaId}`);
  await page.waitForLoadState('networkidle');
  await sairEmOutraAba(context);
  await page.getByLabel('Nome da loja').fill('Loja Sessão Renomeada');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();

  await page.waitForURL(/\/entrar\?/);
  const naVolta = new URL(page.url());
  expect(naVolta.searchParams.get('aviso')).toBe('sessao-encerrada');
  expect(naVolta.searchParams.get('proximo')).toBe(`/lojas/${lojaId}`);
  await expect(page.getByText(RECADO)).toBeVisible();
  await expect(page.getByText('An unexpected response')).toHaveCount(0);

  // Depois da senha, a tela em que estava.
  await entrarDeNovo(page, email);
  await page.waitForURL(`/lojas/${lojaId}`);
  await expect(page.getByLabel('Nome da loja')).toHaveValue('Loja Sessão');

  // O editor: o rascunho que não salvou leva ao login, e não a "sem conexão" para sempre.
  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Abas' }).click();
  await sairEmOutraAba(context);
  await page.getByRole('button', { name: 'Remover Conta' }).click();
  await page.waitForURL(/\/entrar\?/);
  expect(new URL(page.url()).searchParams.get('proximo')).toBe('/app');
  await expect(page.getByText(RECADO)).toBeVisible();
  await entrarDeNovo(page, email);
  await page.waitForURL('/app');
});

test('a sessão que o servidor recusou, com o cookie ainda aqui, também explica — no painel e no admin', async ({
  page,
  context,
}) => {
  const email = emailDeTeste('sessao-recusada');
  await criarUsuarioConfirmado(email, 'Empresa Sessão Recusada');
  await entrar(page, email);

  await invalidarASessao(context);
  await page.goto('/configuracoes/equipe');
  await page.waitForURL(/\/entrar\?/);
  const naVolta = new URL(page.url());
  expect(naVolta.searchParams.get('aviso')).toBe('sessao-encerrada');
  expect(naVolta.searchParams.get('proximo')).toBe('/configuracoes/equipe');
  await expect(page.getByText(RECADO)).toBeVisible();
  await entrarDeNovo(page, email);
  await page.waitForURL('/configuracoes/equipe');

  // Quem nunca entrou (sem cookie nenhum) vê o login de sempre, sem recado.
  await context.clearCookies();
  await page.goto('/configuracoes');
  await page.waitForURL(/\/entrar\?proximo=/);
  await expect(page.getByText(RECADO)).toHaveCount(0);

  // O admin diz o mesmo no login dele.
  const emailEquipe = emailDeTeste('sessao-equipe');
  await tornarPlatformAdmin(await criarUsuarioConfirmado(emailEquipe, 'Equipe Storefy'));
  await entrar(page, emailEquipe);
  await invalidarASessao(context);
  await page.goto('/admin/logs');
  await page.waitForURL(/\/admin\/entrar\?aviso=sessao-encerrada$/);
  await expect(page.getByText(RECADO)).toBeVisible();
});

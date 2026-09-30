/** C01 — cadastro, login, validações e proteção de rota. */
import { expect, test } from './base';
import {
  MOTIVO_PULO,
  SENHA_PADRAO,
  SUPABASE_DISPONIVEL,
  criarLojaPelaTela,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
} from './apoio';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

test('rota protegida manda para o login e volta depois de entrar', async ({ page }) => {
  const email = emailDeTeste('protegida');
  await criarUsuarioConfirmado(email, 'Empresa Protegida');

  await page.goto('/lojas');
  await expect(page).toHaveURL(/\/entrar\?proximo=%2Flojas/);

  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA_PADRAO);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  // Volta para onde o usuário queria ir, não para a raiz.
  await expect(page).toHaveURL('/lojas');

  // Com a busca junto: o período escolhido no Analytics volta escolhido.
  await page.context().clearCookies();
  await page.goto('/analytics?periodo=90');
  await expect(page).toHaveURL(/\/entrar\?proximo=%2Fanalytics%3Fperiodo%3D90$/);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA_PADRAO);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/analytics\?periodo=90$/);
});

/*
 * O golpe do `proximo`: um link para a página de login VERDADEIRA que, depois
 * da senha, levaria a pessoa a uma cópia da Storefy pedindo a senha "de novo".
 * Cada disfarce que o navegador leria como outro site vira o início.
 */
test('o "proximo" do login nunca leva para fora do site', async ({ page, baseURL }) => {
  const email = emailDeTeste('proximo');
  await criarUsuarioConfirmado(email, 'Empresa Próximo');
  const nosso = new URL(baseURL ?? 'http://app.localhost:3000').host;

  for (const disfarce of [
    '//exemplo.test/entrar',
    '/%5Cexemplo.test',
    '/%09/exemplo.test',
    '/..//exemplo.test',
  ]) {
    await page.context().clearCookies();
    await page.goto(`/entrar?proximo=${disfarce}`);
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(SENHA_PADRAO);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/', { timeout: 10_000 });
    expect(new URL(page.url()).host, disfarce).toBe(nosso);
  }
});

test('login com senha errada mostra erro sem revelar se o e-mail existe', async ({ page }) => {
  const email = emailDeTeste('senha-errada');
  await criarUsuarioConfirmado(email, 'Empresa Senha');

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-completamente-errada');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  await expect(
    page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/entrar/);

  /*
   * O e-mail FICA; só a senha volta vazia. O React 19 limpa sozinho os campos
   * não controlados no fim de toda ação de formulário, e era o que acontecia
   * aqui: a pessoa errava a senha e tinha de digitar o e-mail de novo.
   */
  await expect(page.getByLabel('E-mail')).toHaveValue(email);
  await expect(page.getByLabel('Senha')).toHaveValue('');
});

/*
 * O preenchimento automático do navegador costuma chegar ANTES de o React
 * assumir a página: o campo mostra o e-mail salvo, mas o estado dele ainda é o
 * vazio. Sem o campo adotar o que já está escrito ao montar, o primeiro erro
 * apagava o e-mail que o navegador tinha preenchido.
 *
 * Os scripts ficam presos até o e-mail estar no campo — é a janela real, só
 * que aberta de propósito e por tempo suficiente para o teste não depender de
 * sorte.
 */
test('e-mail preenchido antes de a página ficar pronta não some depois do erro', async ({
  page,
}) => {
  const email = emailDeTeste('autofill');
  await criarUsuarioConfirmado(email, 'Empresa Autofill');

  let liberar: () => void = () => undefined;
  const liberados = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  // Só os scripts: segurar o CSS também seguraria a pintura da página, e o
  // campo nunca ficaria visível para ser preenchido.
  await page.route(
    (url) => url.pathname.startsWith('/_next/static/') && url.pathname.endsWith('.js'),
    async (rota) => {
      await liberados;
      await rota.continue();
    },
  );

  // `commit`, e não `domcontentloaded`: os scripts do Next são módulos, e o
  // DOMContentLoaded espera por eles — ficaria esperando pelo que está preso.
  await page.goto('/entrar', { waitUntil: 'commit' });
  await page.getByLabel('E-mail').fill(email);
  liberar();
  await page.waitForLoadState('networkidle');

  await page.getByLabel('Senha').fill('senha-completamente-errada');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  await expect(
    page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos' }),
  ).toBeVisible();
  await expect(page.getByLabel('E-mail')).toHaveValue(email);
});

test('cadastro recusado não apaga o nome da empresa nem o e-mail', async ({ page }) => {
  await page.goto('/cadastrar');
  await page.getByLabel('Nome da sua empresa').fill('Empresa Que Fica');
  await page.getByLabel('E-mail').fill('ainda-nao-e-email');
  await page.getByLabel('Senha').fill(SENHA_PADRAO);
  await page.getByRole('button', { name: 'Criar conta' }).click();

  await expect(page.getByText('E-mail inválido')).toBeVisible();
  await expect(page.getByLabel('Nome da sua empresa')).toHaveValue('Empresa Que Fica');
  await expect(page.getByLabel('E-mail')).toHaveValue('ainda-nao-e-email');
  await expect(page.getByLabel('Senha')).toHaveValue('');
});

test('formulário de cadastro valida campos vazios e senha curta', async ({ page }) => {
  await page.goto('/cadastrar');

  await page.getByLabel('Nome da sua empresa').fill('X');
  await page.getByLabel('E-mail').fill('nao-e-email');
  await page.getByLabel('Senha').fill('123');
  await page.getByRole('button', { name: 'Criar conta' }).click();

  await expect(page.getByText('pelo menos 2 caracteres')).toBeVisible();
  await expect(page.getByText('E-mail inválido')).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'pelo menos 8 caracteres' }),
  ).toBeVisible();
});

test('cadastro cria a organização com o nome informado', async ({ page }) => {
  const email = emailDeTeste('cadastro');
  const empresa = `Empresa ${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/cadastrar');
  await page.getByLabel('Nome da sua empresa').fill(empresa);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA_PADRAO);
  await page.getByRole('button', { name: 'Criar conta' }).click();

  // Com confirmação de e-mail ligada, cai no aviso; sem ela, já entra.
  await page.waitForURL(/\/(confirmar-email|$)/);

  if (page.url().includes('confirmar-email')) {
    await expect(page.getByText(email)).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: new RegExp(empresa) })).toBeVisible();
  }
});

test('sair encerra a sessão e bloqueia a rota de novo', async ({ page }) => {
  const email = emailDeTeste('sair');
  await criarUsuarioConfirmado(email, 'Empresa Sair');
  await entrar(page, email);

  await page.getByRole('button', { name: 'Menu da conta' }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await page.waitForURL(/\/entrar/);

  await page.goto('/lojas');
  await expect(page).toHaveURL(/\/entrar/);
});

test('depois de sair, o botão Voltar do navegador não mostra o painel de novo', async ({
  page,
}) => {
  const email = emailDeTeste('voltar');
  await criarUsuarioConfirmado(email, 'Empresa Voltar');
  await entrar(page, email);
  await criarLojaPelaTela(page, 'Loja do Voltar', 'loja-do-voltar.com.br');

  await page.goto('/lojas');
  await expect(page.getByText('Loja do Voltar').first()).toBeVisible();

  await page.getByRole('button', { name: 'Menu da conta' }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await page.waitForURL(/\/entrar/);

  // Quem senta depois no mesmo computador aperta Voltar: a tela da loja não
  // volta da memória do navegador nem da do painel — vem o login.
  await page.goBack();
  await expect(page).toHaveURL(/\/entrar/);
  await expect(page.getByText('Loja do Voltar')).toHaveCount(0);
});

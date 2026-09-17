/** C01 — cadastro, login, validações e proteção de rota. */
import { expect, test } from '@playwright/test';
import {
  MOTIVO_PULO,
  SENHA_PADRAO,
  SUPABASE_DISPONIVEL,
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
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Volta para onde o usuário queria ir, não para a raiz.
  await expect(page).toHaveURL('/lojas');
});

test('login com senha errada mostra erro sem revelar se o e-mail existe', async ({ page }) => {
  const email = emailDeTeste('senha-errada');
  await criarUsuarioConfirmado(email, 'Empresa Senha');

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-completamente-errada');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos');
  await expect(page).toHaveURL(/\/entrar/);
});

test('formulário de cadastro valida campos vazios e senha curta', async ({ page }) => {
  await page.goto('/cadastrar');

  await page.getByLabel('Nome da sua empresa').fill('X');
  await page.getByLabel('E-mail').fill('nao-e-email');
  await page.getByLabel('Senha').fill('123');
  await page.getByRole('button', { name: 'Criar conta' }).click();

  await expect(page.getByText('pelo menos 2 caracteres')).toBeVisible();
  await expect(page.getByText('E-mail inválido')).toBeVisible();
  await expect(page.getByText('pelo menos 8 caracteres')).toBeVisible();
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
  await page.getByRole('button', { name: 'Sair' }).click();
  await page.waitForURL(/\/entrar/);

  await page.goto('/lojas');
  await expect(page).toHaveURL(/\/entrar/);
});

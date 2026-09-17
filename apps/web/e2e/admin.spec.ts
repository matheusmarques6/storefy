/** A01 e a guarda do painel admin. */
import { expect, test } from '@playwright/test';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
  tornarPlatformAdmin,
} from './apoio';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

test('usuário comum autenticado é barrado no admin', async ({ page }) => {
  const email = emailDeTeste('cliente-no-admin');
  await criarUsuarioConfirmado(email, 'Empresa Cliente');
  await entrar(page, email);

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/sem-acesso/);
  await expect(page.getByText('Acesso restrito')).toBeVisible();
  // Nada de dado de outras organizações vaza nessa tela.
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('visitante sem sessão é mandado para o login do admin', async ({ page }) => {
  await page.goto('/admin/lojas');
  await expect(page).toHaveURL(/\/admin\/entrar/);
});

test('platform admin enxerga organizações e lojas de todos os clientes', async ({ browser }) => {
  const contextoCliente = await browser.newContext();
  const contextoAdmin = await browser.newContext();
  const paginaCliente = await contextoCliente.newPage();
  const paginaAdmin = await contextoAdmin.newPage();

  const emailCliente = emailDeTeste('cliente-visivel');
  const empresa = `Empresa Visivel ${Math.random().toString(36).slice(2, 8)}`;
  await criarUsuarioConfirmado(emailCliente, empresa);

  await entrar(paginaCliente, emailCliente);
  await paginaCliente.goto('/lojas/nova');
  await paginaCliente.getByLabel('Nome da loja').fill('Loja Visivel');
  await paginaCliente.getByLabel('Endereço da loja').fill('loja-visivel.com.br');
  await paginaCliente.getByRole('button', { name: 'Criar loja' }).click();
  await paginaCliente.waitForURL(/\/lojas\/[0-9a-f-]+/);

  const emailAdmin = emailDeTeste('equipe');
  const idAdmin = await criarUsuarioConfirmado(emailAdmin, 'Equipe Storefy');
  await tornarPlatformAdmin(idAdmin);

  await entrar(paginaAdmin, emailAdmin);
  await paginaAdmin.goto('/admin');
  await paginaAdmin.getByRole('searchbox').fill(empresa);
  await paginaAdmin.getByRole('button', { name: 'Buscar' }).click();
  await expect(paginaAdmin.getByRole('cell', { name: empresa })).toBeVisible();

  // Detalhe mostra loja e membro.
  await paginaAdmin.getByRole('link', { name: 'Detalhes' }).first().click();
  await expect(paginaAdmin.getByText('Loja Visivel')).toBeVisible();
  await expect(paginaAdmin.getByText(emailCliente)).toBeVisible();

  // A auditoria registrou a criação da loja.
  await paginaAdmin.goto('/admin/logs');
  await expect(paginaAdmin.getByRole('cell', { name: 'stores' }).first()).toBeVisible();

  await contextoCliente.close();
  await contextoAdmin.close();
});

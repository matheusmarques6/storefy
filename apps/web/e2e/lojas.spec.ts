/** Ciclo completo de loja: criar, alternar, editar e excluir. */
import { expect, test } from '@playwright/test';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
} from './apoio';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

test('cria duas lojas, alterna entre elas, edita e exclui uma', async ({ page }) => {
  const email = emailDeTeste('lojas');
  await criarUsuarioConfirmado(email, 'Empresa Lojas');
  await entrar(page, email);

  // Estado vazio guiando à primeira loja, sem número inventado.
  await expect(page.getByText('Nenhuma loja por aqui ainda')).toBeVisible();

  await page.getByRole('link', { name: 'Cadastrar minha primeira loja' }).click();
  await page.getByLabel('Nome da loja').fill('Loja Um');
  await page.getByLabel('Endereço da loja').fill('loja-um.com.br');
  await page.getByRole('button', { name: 'Criar loja' }).click();

  await expect(page.getByText('Loja criada')).toBeVisible();
  // A URL é normalizada para https mesmo sem o usuário digitar o esquema.
  await expect(page.getByText('https://loja-um.com.br')).toBeVisible();

  // Segunda loja.
  await page.goto('/lojas/nova');
  await page.getByLabel('Nome da loja').fill('Loja Dois');
  await page.getByLabel('Endereço da loja').fill('loja-dois.com.br');
  await page.getByRole('button', { name: 'Criar loja' }).click();
  await expect(page.getByText('Loja criada')).toBeVisible();

  // O seletor mostra a recém-criada como ativa e lista as duas.
  await page.getByRole('button', { name: 'Trocar de loja' }).click();
  await expect(page.getByRole('menuitem', { name: 'Loja Um' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Loja Dois' })).toBeVisible();

  await page.getByRole('menuitem', { name: 'Loja Um' }).click();
  await expect(page.getByRole('button', { name: 'Trocar de loja' })).toContainText('Loja Um');

  // Editar.
  await page.goto('/lojas');
  await page
    .getByRole('row', { name: /Loja Um/ })
    .getByRole('link', { name: 'Abrir' })
    .click();
  await page.getByLabel('Nome da loja').fill('Loja Um Renomeada');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Alterações salvas')).toBeVisible();

  // Excluir, sempre com confirmação.
  await page.getByRole('button', { name: 'Excluir loja' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Loja Um Renomeada');
  await page.getByRole('button', { name: 'Sim, excluir' }).click();

  await page.waitForURL(/\/lojas/);
  await expect(page.getByRole('cell', { name: 'Loja Um Renomeada' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Loja Dois' })).toBeVisible();
});

test('recusa endereço inválido com mensagem clara', async ({ page }) => {
  const email = emailDeTeste('url-invalida');
  await criarUsuarioConfirmado(email, 'Empresa URL');
  await entrar(page, email);

  await page.goto('/lojas/nova');
  await page.getByLabel('Nome da loja').fill('Loja Teste');
  await page.getByLabel('Endereço da loja').fill('nao-e-um-dominio');
  await page.getByRole('button', { name: 'Criar loja' }).click();

  await expect(page.getByText('Endereço inválido')).toBeVisible();
});

test('recusa duas lojas com o mesmo endereço na mesma empresa', async ({ page }) => {
  const email = emailDeTeste('url-duplicada');
  await criarUsuarioConfirmado(email, 'Empresa Duplicada');
  await entrar(page, email);

  for (const tentativa of [1, 2]) {
    await page.goto('/lojas/nova');
    await page.getByLabel('Nome da loja').fill(`Loja ${String(tentativa)}`);
    await page.getByLabel('Endereço da loja').fill('mesma-url.com.br');
    await page.getByRole('button', { name: 'Criar loja' }).click();
    if (tentativa === 1) await expect(page.getByText('Loja criada')).toBeVisible();
  }

  await expect(page.getByRole('alert')).toContainText('Já existe uma loja com este endereço');
});

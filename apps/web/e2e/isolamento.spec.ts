/**
 * Isolamento entre organizações, pela interface.
 *
 * A RLS já é testada no banco (supabase/tests/rls.test.sql). Aqui provamos que
 * o painel também não vaza: nem por listagem, nem por URL direta.
 */
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

test('usuário de outra empresa não vê nem acessa a loja alheia', async ({ browser }) => {
  const contextoA = await browser.newContext();
  const contextoB = await browser.newContext();
  const paginaA = await contextoA.newPage();
  const paginaB = await contextoB.newPage();

  const emailA = emailDeTeste('org-a');
  const emailB = emailDeTeste('org-b');
  await criarUsuarioConfirmado(emailA, 'Empresa A');
  await criarUsuarioConfirmado(emailB, 'Empresa B');

  // A cria uma loja.
  await entrar(paginaA, emailA);
  await paginaA.goto('/lojas/nova');
  await paginaA.getByLabel('Nome da loja').fill('Loja Secreta da A');
  await paginaA.getByLabel('Endereço da loja').fill('loja-secreta-a.com.br');
  await paginaA.getByRole('button', { name: 'Criar loja' }).click();
  await paginaA.waitForURL(/\/lojas\/[0-9a-f-]+/);
  const urlDaLojaDeA = new URL(paginaA.url()).pathname;

  // B entra e não enxerga nada de A.
  await entrar(paginaB, emailB);
  await paginaB.goto('/lojas');
  await expect(paginaB.getByText('Nenhuma loja cadastrada')).toBeVisible();
  await expect(paginaB.getByText('Loja Secreta da A')).toHaveCount(0);

  // Nem pela URL direta: a RLS não devolve a linha, então vira 404.
  await paginaB.goto(urlDaLojaDeA);
  await expect(paginaB.getByText('Página não encontrada')).toBeVisible();
  await expect(paginaB.getByText('Loja Secreta da A')).toHaveCount(0);

  await contextoA.close();
  await contextoB.close();
});

test('cookie de loja adulterado não dá acesso à loja de outra empresa', async ({ browser }) => {
  const contextoA = await browser.newContext();
  const contextoB = await browser.newContext();
  const paginaA = await contextoA.newPage();
  const paginaB = await contextoB.newPage();

  const emailA = emailDeTeste('cookie-a');
  const emailB = emailDeTeste('cookie-b');
  await criarUsuarioConfirmado(emailA, 'Empresa Cookie A');
  await criarUsuarioConfirmado(emailB, 'Empresa Cookie B');

  await entrar(paginaA, emailA);
  await paginaA.goto('/lojas/nova');
  await paginaA.getByLabel('Nome da loja').fill('Loja Cookie A');
  await paginaA.getByLabel('Endereço da loja').fill('loja-cookie-a.com.br');
  await paginaA.getByRole('button', { name: 'Criar loja' }).click();
  await paginaA.waitForURL(/\/lojas\/[0-9a-f-]+/);
  const idDaLojaDeA = paginaA.url().split('/').pop()?.split('?')[0] ?? '';

  await entrar(paginaB, emailB);
  // Planta o id da loja de A no cookie de contexto de B.
  await contextoB.addCookies([
    {
      name: 'storefy_loja',
      value: idDaLojaDeA,
      domain: new URL(paginaB.url()).hostname,
      path: '/',
    },
  ]);

  await paginaB.goto('/');
  // O contexto é recalculado a partir do que a RLS devolve, então o cookie
  // inválido é simplesmente ignorado.
  await expect(paginaB.getByText('Loja Cookie A')).toHaveCount(0);
  await expect(paginaB.getByText('Nenhuma loja por aqui ainda')).toBeVisible();

  await contextoA.close();
  await contextoB.close();
});

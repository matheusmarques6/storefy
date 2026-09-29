/** Ciclo completo de loja: criar, alternar, editar e excluir. */
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

  await expect(
    page.getByRole('alert').filter({ hasText: 'Já existe uma loja com este endereço' }),
  ).toBeVisible();
});

/*
 * O fuso existia no banco com "o lojista ajusta" no comentário da coluna — e
 * nenhuma tela para ajustar. Toda loja ficava presa no horário de Brasília:
 * agendamento, silêncio noturno e fechamento do dia.
 */
test('o fuso da loja se troca na tela, e a troca fica na auditoria', async ({ page }) => {
  const email = emailDeTeste('fuso');
  await criarUsuarioConfirmado(email, 'Empresa Fuso');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja do Norte', 'loja-do-norte.com.br');
  // O cadastro segue para o começo guiado; o fuso fica na página da loja.
  await page.goto(`/lojas/${lojaId}`);

  const campo = page.getByLabel('Fuso horário');
  await expect(campo).toHaveValue('America/Sao_Paulo');

  // O lojista escolhe pelo estado, e a lista diz a diferença para Brasília.
  await expect(campo.locator('option[value="America/Manaus"]')).toHaveText(
    'Amazonas (1 hora a menos que Brasília)',
  );
  await campo.selectOption('America/Manaus');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();

  await expect(page.getByText('Alterações salvas')).toBeVisible();
  await expect(page.getByLabel('Fuso horário')).toHaveValue('America/Manaus');

  const banco = bancoDeTeste();
  const { data: loja } = await banco.from('stores').select('timezone').eq('id', lojaId).single();
  expect(loja?.timezone).toBe('America/Manaus');

  const { data: trilha } = await banco
    .from('audit_logs')
    .select('diff')
    .eq('entity', 'stores')
    .eq('entity_id', lojaId)
    .eq('action', 'update');
  expect(JSON.stringify(trilha)).toContain('America/Manaus');
});

test('e-mail de atendimento recusado não apaga o que foi digitado', async ({ page }) => {
  const email = emailDeTeste('contato');
  await criarUsuarioConfirmado(email, 'Empresa Contato');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Contato', 'loja-contato.com.br');
  await page.goto(`/lojas/${lojaId}`);

  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail de atendimento').fill('atendimento@');
  await page.getByLabel('Fuso horário').selectOption('America/Rio_Branco');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();

  await expect(
    page.getByRole('alert').filter({ hasText: 'Digite um e-mail válido' }),
  ).toBeVisible();
  // O React limpava o campo ao fim da ação, erro ou não: a pessoa via a
  // mensagem embaixo de um campo que não tinha mais o que ela escreveu.
  await expect(page.getByLabel('E-mail de atendimento')).toHaveValue('atendimento@');
  await expect(page.getByLabel('Nome da loja')).toHaveValue('Loja Contato');
  /*
   * E o seletor, que é pior: num `<select>` o React só lê o `defaultValue` ao
   * montar, e a limpeza voltava o fuso para o de antes SEM AVISO. Corrigido o
   * e-mail, o "Salvar" gravaria o fuso antigo achando que gravou o novo.
   */
  await expect(page.getByLabel('Fuso horário')).toHaveValue('America/Rio_Branco');

  await page.getByLabel('E-mail de atendimento').fill('atendimento@loja-contato.com.br');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Alterações salvas')).toBeVisible();
  await expect(page.getByLabel('Fuso horário')).toHaveValue('America/Rio_Branco');
});

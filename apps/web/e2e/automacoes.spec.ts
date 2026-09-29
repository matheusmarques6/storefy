/**
 * As automações de push (C09), pela tela.
 *
 * Este teste nasceu de um defeito: o "estreitador" de tipo da ação de salvar
 * foi escrito quando só existiam boas-vindas e carrinho abandonado, e gravava
 * TODA automação nova como carrinho abandonado. Ligar "Pedido enviado" ou "De
 * volta ao estoque" reescrevia o texto do carrinho — e as duas nunca ligavam.
 * Sem um teste que ligasse cada uma pela tela e olhasse o banco, ninguém viu.
 */
import { expect, test, type Page } from '@playwright/test';
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

const AUTOMACOES = [
  { tipo: 'welcome', nome: 'Boas-vindas', titulo: 'Bem-vindo!' },
  { tipo: 'abandoned_cart', nome: 'Carrinho abandonado', titulo: 'Esqueceu algo?' },
  { tipo: 'order_shipped', nome: 'Pedido enviado', titulo: 'Seu pedido saiu para entrega' },
  { tipo: 'back_in_stock', nome: 'De volta ao estoque', titulo: 'Voltou!' },
  {
    tipo: 'inactive_7d',
    nome: 'Sentimos sua falta',
    titulo: 'Faz tempo que você não passa por aqui',
  },
] as const;

async function automacoesNoBanco(lojaId: string) {
  const { data: app } = await bancoDeTeste()
    .from('apps')
    .select('id')
    .eq('store_id', lojaId)
    .single();
  if (app == null) throw new Error('A loja de teste ficou sem app.');
  const { data, error } = await bancoDeTeste()
    .from('push_automations')
    .select('type, enabled, title, delay_minutes')
    .eq('app_id', app.id)
    .order('type');
  if (error != null) throw new Error(error.message);
  return data;
}

function cartao(page: Page, nome: string) {
  return page.getByRole('region', { name: nome, exact: true });
}

test('cada automação liga com o próprio tipo, e o "sentimos sua falta" escolhe a hora', async ({
  page,
}) => {
  const email = emailDeTeste('automacoes');
  await criarUsuarioConfirmado(email, 'Empresa Automações');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Automações', 'loja-automacoes.com.br');

  await page.goto('/push/automacoes');
  await page.waitForLoadState('networkidle');

  // Liga uma por uma, pela chave de cada card.
  for (const { nome } of AUTOMACOES) {
    await cartao(page, nome)
      .getByRole('switch', { name: `Ligar ${nome}` })
      .click();
    await expect(page.getByText(`Automação “${nome}” ligada.`)).toBeVisible();
    await expect(
      cartao(page, nome).getByRole('switch', { name: `Desligar ${nome}` }),
    ).toBeChecked();
  }

  // No banco, cinco automações — cada uma com o SEU tipo e o SEU texto.
  const ligadas = await automacoesNoBanco(lojaId);
  expect(ligadas.map((linha) => linha.type).sort()).toEqual(
    AUTOMACOES.map((automacao) => automacao.tipo).sort(),
  );
  for (const { tipo, titulo } of AUTOMACOES) {
    const linha = ligadas.find((automacao) => automacao.type === tipo);
    expect(linha, tipo).toMatchObject({ enabled: true, title: titulo });
  }

  // O "sentimos sua falta" diz QUANDO sai, e a hora se escolhe no 7º dia.
  const inativo = cartao(page, 'Sentimos sua falta');
  await expect(inativo.getByText('Ligada · envia no 7º dia sem abrir o app, às 10h')).toBeVisible();
  await inativo.getByRole('button', { name: 'Editar mensagem' }).click();
  const horario = inativo.getByLabel('Horário do envio, no 7º dia');
  await expect(horario.locator('option')).toHaveText([
    'Às 8h',
    'Às 10h',
    'Às 12h',
    'Às 15h',
    'Às 18h',
    'Às 20h',
  ]);
  await horario.selectOption({ label: 'Às 12h' });
  await inativo.getByRole('button', { name: 'Salvar mensagem' }).click();
  await expect(inativo.getByText('Ligada · envia no 7º dia sem abrir o app, às 12h')).toBeVisible();
  expect(
    (await automacoesNoBanco(lojaId)).find((linha) => linha.type === 'inactive_7d')?.delay_minutes,
  ).toBe(720);

  // Desligar uma não mexe nas outras — em especial no carrinho abandonado.
  await cartao(page, 'Pedido enviado')
    .getByRole('switch', { name: 'Desligar Pedido enviado' })
    .click();
  await expect(page.getByText('Automação “Pedido enviado” desligada.')).toBeVisible();
  const depois = await automacoesNoBanco(lojaId);
  expect(depois.find((linha) => linha.type === 'order_shipped')?.enabled).toBe(false);
  expect(depois.find((linha) => linha.type === 'abandoned_cart')).toMatchObject({
    enabled: true,
    title: 'Esqueceu algo?',
  });
});

/**
 * A receita do push (C07, C09 e C10): do webhook da Shopify até a tela.
 *
 * O pedido entra pelo webhook DE VERDADE — assinado, pela mesma rota que a
 * Shopify chama —, com os atributos que o app grava no carrinho depois do
 * toque. O que se prepara pelo banco é só o que a tela não tem como fazer
 * num teste: a conexão com a Shopify (o OAuth dela) e o envio pela OneSignal
 * (a campanha que saiu, os números dela e o envio da automação).
 *
 * Os atributos são escritos aqui à mão, e não com as funções do produto: um
 * teste que monta o valor com o código que testa não prova que os dois lados
 * falam a mesma língua.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './base';
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
import { varrer } from './axe';
import { conectarShopify, webhookDoPedido } from './shopify-de-teste';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

const segundos = (quando: Date): string => String(Math.floor(quando.getTime() / 1000));

/** O texto com o espaço normal no lugar do não separável do `Intl` ("R$ 1,00"). */
async function textoDe(page: Page, testId: string): Promise<string> {
  return ((await page.getByTestId(testId).textContent()) ?? '').replace(/\u00a0/g, ' ');
}

test('o pedido que veio de um toque aparece na lista, no funil e na automação', async ({
  page,
}) => {
  const email = emailDeTeste('receita-push');
  await criarUsuarioConfirmado(email, 'Empresa Receita');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Receita', 'loja-receita.com.br');

  const banco = bancoDeTeste();
  const { data: app } = await banco.from('apps').select('id').eq('store_id', lojaId).single();
  if (app == null) throw new Error('A loja de teste ficou sem app.');

  // Sem a Shopify, a tela não afirma receita nenhuma: traço, e o porquê.
  await page.goto('/push');
  // O card inteiro: o rótulo, o valor e a legenda.
  const vendas = page.getByText('Vendas pelas notificações', { exact: true }).locator('..');
  await expect(vendas).toContainText('—');
  await expect(
    vendas.getByText('Conecte a Shopify para ver quanto cada notificação vendeu.'),
  ).toBeVisible();

  // O que a OneSignal faria: a campanha saiu, e os números chegaram.
  const agora = new Date();
  const { data: campanha, error: erroDaCampanha } = await banco
    .from('push_campaigns')
    .insert({
      app_id: app.id,
      title: 'Liquida de primavera',
      body: 'Até 40% off em toda a loja',
      status: 'sent',
      sent_at: new Date(agora.getTime() - 60 * 60 * 1000).toISOString(),
      stats: { enviados: 120, entregues: 100, abertos: 12 },
    })
    .select('id')
    .single();
  if (erroDaCampanha != null) throw new Error(erroDaCampanha.message);

  // E a automação de carrinho abandonado, ligada, com um envio feito.
  await page.goto('/push/automacoes');
  const carrinho = page.getByRole('region', { name: 'Carrinho abandonado', exact: true });
  await carrinho.getByRole('switch', { name: 'Ligar Carrinho abandonado' }).click();
  await expect(page.getByText('Automação “Carrinho abandonado” ligada.')).toBeVisible();

  const { data: automacao } = await banco
    .from('push_automations')
    .select('id')
    .eq('app_id', app.id)
    .eq('type', 'abandoned_cart')
    .single();
  const { data: aparelho } = await banco
    .from('devices')
    .insert({ app_id: app.id, onesignal_subscription_id: 'sub-receita-e2e', platform: 'ios' })
    .select('id')
    .single();
  await banco.from('automation_runs').insert({
    automation_id: automacao?.id ?? '',
    device_id: aparelho?.id ?? '',
    status: 'sent',
    scheduled_for: agora.toISOString(),
    sent_at: agora.toISOString(),
  });

  const dominio = `receita-${String(Date.now())}.myshopify.com`;
  await conectarShopify(lojaId, dominio);

  // Os pedidos, pelo webhook assinado.
  const doToque = await webhookDoPedido(page, dominio, {
    id: 9001,
    total: '149.90',
    push: `c:${campanha.id}:${segundos(agora)}`,
  });
  expect(doToque).toEqual({ status: 200, corpo: { ok: true, feito: 'pedido', novo: true } });

  // A Shopify reentrega: o mesmo pedido não conta duas vezes.
  const reentrega = await webhookDoPedido(page, dominio, {
    id: 9001,
    total: '149.90',
    push: `c:${campanha.id}:${segundos(agora)}`,
  });
  expect(reentrega.corpo).toMatchObject({ novo: false });

  await webhookDoPedido(page, dominio, {
    id: 9002,
    total: '59.90',
    push: `a:${automacao?.id ?? ''}:${segundos(agora)}`,
  });

  // Carrinho parado: o toque foi há cinco dias, e a compra não é mérito dele.
  const cincoDiasAtras = new Date(agora.getTime() - 5 * 24 * 60 * 60 * 1000);
  await webhookDoPedido(page, dominio, {
    id: 9003,
    total: '999.00',
    push: `c:${campanha.id}:${segundos(cincoDiasAtras)}`,
  });

  // Pedido do app sem toque nenhum: é do app, não do push.
  await webhookDoPedido(page, dominio, { id: 9004, total: '10.00' });

  const { data: pedidos } = await banco
    .from('shop_orders')
    .select('shopify_order_id, source, push_campaign_id, push_automation_id')
    .eq('app_id', app.id)
    .order('shopify_order_id');
  expect(pedidos).toEqual([
    {
      shopify_order_id: '9001',
      source: 'app',
      push_campaign_id: campanha.id,
      push_automation_id: null,
    },
    {
      shopify_order_id: '9002',
      source: 'app',
      push_campaign_id: null,
      push_automation_id: automacao?.id,
    },
    { shopify_order_id: '9003', source: 'app', push_campaign_id: null, push_automation_id: null },
    { shopify_order_id: '9004', source: 'app', push_campaign_id: null, push_automation_id: null },
  ]);

  // C07: o topo soma campanha e automação; a linha da campanha, só ela.
  await page.goto('/push');
  await expect(vendas).toContainText('R$ 209,80');
  await expect(
    vendas.getByText('2 pedidos nos últimos 30 dias, de quem tocou numa notificação.'),
  ).toBeVisible();

  const linha = page.getByRole('listitem').filter({ hasText: 'Liquida de primavera' });
  await expect(linha.getByText('R$ 149,90', { exact: true })).toBeVisible();
  await expect(linha.getByText('1 pedido', { exact: true })).toBeVisible();
  await expect(linha.getByText('12', { exact: true })).toBeVisible();
  await expect(linha.getByText('12% abriram')).toBeVisible();
  await varrer(page, 'C07 com números e receita');

  // C10: o funil, etapa por etapa, e a receita com o ticket médio.
  await linha.getByRole('link', { name: 'Liquida de primavera' }).click();
  await page.waitForURL(`**/push/${campanha.id}`);
  await expect(page.getByRole('heading', { name: 'Do envio à venda' })).toBeVisible();
  expect(await textoDe(page, 'funil-enviados')).toBe('120');
  expect(await textoDe(page, 'funil-entregues')).toBe('100');
  expect(await textoDe(page, 'funil-aberturas')).toBe('12');
  expect(await textoDe(page, 'funil-pedidos')).toBe('1');
  await expect(page.getByText('· 83,3% da etapa anterior')).toBeVisible();
  await expect(page.getByText('· 12% da etapa anterior')).toBeVisible();
  await expect(page.getByText('· 8,3% da etapa anterior')).toBeVisible();
  const receita = await textoDe(page, 'receita-da-campanha');
  expect(receita).toContain('R$ 149,90');
  expect(receita).toContain('1 pedido, ticket médio de R$ 149,90.');
  await varrer(page, 'C10 com o funil e a receita');

  // C09: o card da automação diz o que ela fez nos últimos 30 dias.
  await page.goto('/push/automacoes');
  const resultado = carrinho.getByRole('region', { name: 'Últimos 30 dias' });
  // Enviadas, aberturas (traço: o app ainda não contou toque nenhum), pedidos e receita.
  await expect(resultado.locator('dd')).toHaveText(['1', '—', '1', /^R\$\s59,90$/]);
  await varrer(page, 'C09 com o resultado da automação');

  // No celular, os números da campanha cabem numa linha embaixo do texto.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/push');
  const noCelular = page
    .getByRole('listitem')
    .filter({ hasText: 'Liquida de primavera' })
    .getByTestId('numeros-no-celular');
  await expect(noCelular).toBeVisible();
  expect(((await noCelular.textContent()) ?? '').replace(/\u00a0/g, ' ')).toBe(
    '120 enviados · 12 aberturas (12%) · R$ 149,90 em 1 pedido',
  );
});

test('outra organização não vê a receita, nem pelo endereço da campanha', async ({ page }) => {
  const dono = emailDeTeste('receita-dono');
  await criarUsuarioConfirmado(dono, 'Empresa Dona');
  await entrar(page, dono);
  const lojaId = await criarLojaPelaTela(page, 'Loja Dona', 'loja-dona-receita.com.br');

  const banco = bancoDeTeste();
  const { data: app } = await banco.from('apps').select('id').eq('store_id', lojaId).single();
  const { data: campanha } = await banco
    .from('push_campaigns')
    .insert({
      app_id: app?.id ?? '',
      title: 'Campanha que só a dona vê',
      body: 'Texto',
      status: 'sent',
      sent_at: new Date().toISOString(),
      stats: { enviados: 10 },
    })
    .select('id')
    .single();

  await page.context().clearCookies();
  const outro = emailDeTeste('receita-outro');
  await criarUsuarioConfirmado(outro, 'Empresa Outra');
  await entrar(page, outro);
  await criarLojaPelaTela(page, 'Loja Outra', 'loja-outra-receita.com.br');

  // Nem pela URL direta: a RLS não devolve a campanha, e a página é a de não encontrada.
  await page.goto(`/push/${campanha?.id ?? ''}`);
  await expect(page.getByText('Página não encontrada')).toBeVisible();
  await expect(page.getByText('Campanha que só a dona vê')).toHaveCount(0);

  await page.goto('/push');
  await expect(page.getByText('Campanha que só a dona vê')).toHaveCount(0);
});

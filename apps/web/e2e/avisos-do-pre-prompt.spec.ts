/**
 * O que o pedido de permissão do app (M03) promete ao cliente.
 *
 * A tela prometia sempre "pedido saiu para entrega" e "de volta ao estoque".
 * Agora o app pergunta à Storefy (`POST /api/public/push-avisos`), e a
 * resposta segue as automações que o lojista liga e desliga no painel — e só
 * promete o que consegue sair: sem a Shopify conectada, pedido enviado e
 * estoque nunca disparam.
 */
import { expect, test } from '@playwright/test';
import { MOTIVO_PULO, SUPABASE_DISPONIVEL, bancoDeTeste, limparUsuariosDeTeste } from './apoio';
import { SEGREDO_DO_WORKFLOW, doApp, lojaComApp, postar } from './app-assinado';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

test('o pedido de permissão promete só os avisos das automações ligadas', async ({ page }) => {
  test.skip(
    SEGREDO_DO_WORKFLOW === '',
    'Defina BUILD_API_SECRET, como o scripts/e2e-local.sh faz.',
  );
  test.setTimeout(120_000);
  const { appId, lojaId, segredo } = await lojaComApp(page, 'avisos-pre-prompt');
  const perguntar = () => doApp(page, segredo, '/api/public/push-avisos', { appId });

  // Só o app, com a assinatura dele, pergunta.
  const semAssinatura = await postar(
    page,
    '/api/public/push-avisos',
    JSON.stringify({ appId }),
    {},
  );
  expect(semAssinatura.status).toBe(401);

  // Nenhuma automação ligada: nada além das promoções.
  expect(await perguntar()).toEqual({ status: 200, corpo: { avisos: [] } });

  // O lojista liga três pela tela.
  await page.goto('/push/automacoes');
  for (const nome of ['Carrinho abandonado', 'Pedido enviado', 'De volta ao estoque']) {
    await page.getByRole('switch', { name: `Ligar ${nome}` }).click();
    await expect(page.getByRole('switch', { name: `Desligar ${nome}` })).toBeVisible();
  }

  /*
   * Sem a Shopify conectada, só o carrinho consegue sair. `poll`: a chave vira
   * na tela antes de a gravação terminar, e a pergunta pode chegar antes dela.
   */
  await expect.poll(perguntar).toEqual({ status: 200, corpo: { avisos: ['carrinho'] } });

  // Com ela conectada (como o OAuth deixa a loja), os três.
  const { error } = await bancoDeTeste()
    .from('stores')
    .update({ platform: 'shopify', shopify_scopes: ['read_orders', 'read_products'] })
    .eq('id', lojaId);
  if (error != null) throw new Error(error.message);
  expect(await perguntar()).toEqual({
    status: 200,
    corpo: { avisos: ['carrinho', 'pedido', 'estoque'] },
  });

  // Desligar no painel tira a promessa do app na hora.
  await page.getByRole('switch', { name: 'Desligar Pedido enviado' }).click();
  await expect(page.getByRole('switch', { name: 'Ligar Pedido enviado' })).toBeVisible();
  await expect.poll(perguntar).toEqual({ status: 200, corpo: { avisos: ['carrinho', 'estoque'] } });
});

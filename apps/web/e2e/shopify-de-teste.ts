/**
 * A Shopify de um teste: a conexão de uma loja e os webhooks que ela manda.
 *
 * A conexão entra pelo banco — o OAuth da Shopify não roda num teste —, com
 * os mesmos campos que a conexão pelo app da loja (C14) grava. Os webhooks
 * saem pela rota DE VERDADE, assinados com o segredo do app da loja, como a
 * Shopify assina.
 */
import { createCipheriv, createHmac, randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { bancoDeTeste } from './apoio';

export const SEGREDO_DO_APP_DA_LOJA = 'segredo-do-app-shopify-do-e2e';

/** Cifra como o servidor cifra (`lib/cripto.ts`), com a mesma ENCRYPTION_KEY. */
export function cifrarComoOServidor(texto: string): string {
  const chave = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  if (chave.length !== 32) throw new Error('O e2e precisa da ENCRYPTION_KEY do servidor.');
  const iv = randomBytes(12);
  const cifrador = createCipheriv('aes-256-gcm', chave, iv);
  const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cifrado.toString('base64'),
    cifrador.getAuthTag().toString('base64'),
  ].join('.');
}

/** A loja passa a estar conectada pelo app personalizado dela, como no C14. */
export async function conectarShopify(lojaId: string, dominio: string): Promise<void> {
  const { error } = await bancoDeTeste()
    .from('stores')
    .update({
      shop_domain: dominio,
      shopify_conexao: 'manual',
      shopify_client_id: 'client-id-do-e2e',
      shopify_client_secret_enc: cifrarComoOServidor(SEGREDO_DO_APP_DA_LOJA),
      shopify_access_token_enc: cifrarComoOServidor('token-do-e2e'),
      shopify_scopes: ['read_orders'],
    })
    .eq('id', lojaId);
  if (error != null) throw new Error(error.message);
}

export interface Pedido {
  id: number;
  total: string;
  /** O valor do `_storefy_push`, ou nada para o pedido que não veio de toque. */
  push?: string;
  criadoEm?: Date;
}

/**
 * Manda o `orders/create` pela rota de verdade. Do navegador, na mesma origem:
 * o `app.localhost` do teste só resolve no Chromium. A assinatura é feita
 * aqui, com o segredo do app da loja, como a Shopify faz.
 */
export async function webhookDoPedido(page: Page, dominio: string, pedido: Pedido) {
  const corpo = JSON.stringify({
    id: pedido.id,
    name: `#${String(pedido.id)}`,
    total_price: pedido.total,
    currency: 'BRL',
    created_at: (pedido.criadoEm ?? new Date()).toISOString(),
    note_attributes: [
      { name: '_storefy', value: '1' },
      ...(pedido.push === undefined ? [] : [{ name: '_storefy_push', value: pedido.push }]),
    ],
  });
  const assinatura = createHmac('sha256', SEGREDO_DO_APP_DA_LOJA)
    .update(corpo, 'utf8')
    .digest('base64');

  return page.evaluate(
    async ({ corpoEnviado, cabecalhos }) => {
      const resposta = await fetch('/api/webhooks/shopify', {
        method: 'POST',
        headers: cabecalhos,
        body: corpoEnviado,
      });
      return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
    },
    {
      corpoEnviado: corpo,
      cabecalhos: {
        'Content-Type': 'application/json',
        'X-Shopify-Topic': 'orders/create',
        'X-Shopify-Shop-Domain': dominio,
        'X-Shopify-Hmac-Sha256': assinatura,
      },
    },
  );
}

import 'server-only';

/**
 * O que cada webhook da Shopify faz (seção 8 do plano).
 *
 * Fica separado da rota porque a rota tem uma responsabilidade só — conferir a
 * assinatura e responder rápido — e porque é aqui que mora a decisão que
 * sustenta o produto: DE ONDE VEIO O PEDIDO.
 *
 * A Shopify desiste do webhook em 5 segundos e reentrega. Toda escrita daqui
 * precisa aguentar chegar duas vezes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import type { Topico } from '@/lib/shopify';

type Client = SupabaseClient<Database>;

/**
 * O atributo que o bridge injeta no carrinho.
 *
 * Underscore na frente porque a Shopify esconde do cliente final os atributos
 * que começam assim: ele não aparece no e-mail de confirmação nem na página de
 * agradecimento, mas chega ao pedido e ao webhook.
 */
export const ATRIBUTO_DO_APP = '_storefy';

export interface ResultadoDoWebhook {
  /** O que a rota devolve no corpo, só para o log. */
  feito: string;
  novo?: boolean;
}

/**
 * De onde veio este pedido?
 *
 * Pelo atributo de carrinho que o app injetou, e não por janela de tempo. Uma
 * heurística de "comprou até 30 minutos depois de abrir o app" erraria toda
 * vez que o cliente abre o app, desiste, e compra pelo site meia hora depois —
 * e o erro seria sempre a favor do app, que é o pior tipo de erro num número
 * que justifica a assinatura.
 */
export function origemDoPedido(pedido: unknown): 'app' | 'site' {
  const atributos = lerAtributos(pedido);
  const marca = atributos[ATRIBUTO_DO_APP];
  return marca === '1' || marca === 'true' ? 'app' : 'site';
}

/** Os `note_attributes` do pedido, como mapa. */
function lerAtributos(pedido: unknown): Record<string, string> {
  if (pedido === null || typeof pedido !== 'object') return {};

  const lista = (pedido as { note_attributes?: unknown }).note_attributes;
  if (!Array.isArray(lista)) return {};

  const mapa: Record<string, string> = {};
  for (const item of lista) {
    if (item === null || typeof item !== 'object') continue;
    const { name, value } = item as { name?: unknown; value?: unknown };
    if (typeof name === 'string' && typeof value === 'string') mapa[name] = value;
  }
  return mapa;
}

/**
 * O total do pedido em centavos.
 *
 * A Shopify manda o valor como TEXTO decimal (`"149.90"`). `Number(x) * 100`
 * devolve 14989.999999999998 para alguns valores, e o arredondamento errado
 * vira centavo faltando na receita do mês. A conta é feita sobre o texto.
 */
export function centavosDoPedido(valor: unknown): number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return Math.round(valor * 100);
  if (typeof valor !== 'string') return 0;

  const limpo = valor.trim();
  if (!/^-?\d+(\.\d+)?$/.test(limpo)) return 0;

  const [inteiro = '0', decimal = ''] = limpo.split('.');
  const centavos = `${decimal}00`.slice(0, 2);
  const sinal = inteiro.startsWith('-') ? -1 : 1;

  const total = Math.abs(Number(inteiro)) * 100 + Number(centavos);
  return Number.isSafeInteger(total) ? sinal * total : 0;
}

/** Texto de um campo do payload, quando ele é texto. */
function texto(objeto: unknown, campo: string): string | null {
  if (objeto === null || typeof objeto !== 'object') return null;
  const valor = (objeto as Record<string, unknown>)[campo];
  if (typeof valor === 'string' && valor !== '') return valor;
  if (typeof valor === 'number') return String(valor);
  return null;
}

export async function aplicarWebhook(
  supabase: Client,
  topico: Topico,
  shop: string,
  corpo: string,
): Promise<ResultadoDoWebhook> {
  /*
   * Os webhooks de privacidade são tratados ANTES de procurar o app: eles
   * precisam funcionar mesmo para uma loja que já desinstalou o app e não está
   * mais no nosso banco. Responder erro neles é motivo de recusa na revisão da
   * Shopify.
   */
  if (topico === 'shop/redact') {
    const { data } = await supabase.rpc('apagar_dados_da_shopify', { p_shop_domain: shop });
    return { feito: `apagados:${String(data ?? 0)}` };
  }

  if (topico === 'app/uninstalled') {
    await supabase.rpc('desconectar_shopify', { p_shop_domain: shop });
    return { feito: 'desconectada' };
  }

  /*
   * `customers/data_request` e `customers/redact` chegam por cliente final.
   * A Storefy NÃO guarda dado de cliente final da loja: o cadastro, o endereço
   * e o pagamento ficam na Shopify, e o que temos é o aparelho — que não sabe
   * quem é a pessoa. Responder 200 sem fazer nada é a resposta CORRETA aqui, e
   * não preguiça; apagar um "cliente" que não existe seria inventar trabalho.
   */
  if (topico === 'customers/data_request' || topico === 'customers/redact') {
    return { feito: 'sem_dado_de_cliente' };
  }

  const { data: encontrado, error } = await supabase.rpc('app_da_loja_shopify', {
    p_shop_domain: shop,
  });
  if (error != null) throw new Error(error.message);

  const app = encontrado[0]?.app_id;

  // Loja que não conhecemos: 200 sem processar, para a Shopify não reentregar
  // para sempre nem desativar o webhook.
  if (app == null) return { feito: 'loja_desconhecida' };

  if (topico === 'orders/create') return await gravarPedido(supabase, app, corpo);

  /*
   * `fulfillments/create` e `products/update` alimentam as automações de
   * "pedido enviado" e "de volta ao estoque", que entram na etapa seguinte
   * desta fase. Até lá são aceitos e ignorados — de propósito, e não por
   * esquecimento: recusá-los faria a Shopify desativar o webhook da loja, e
   * registrá-los de novo depois exigiria reinstalar o app.
   */
  return { feito: `aceito:${topico}` };
}

async function gravarPedido(
  supabase: Client,
  appId: string,
  corpo: string,
): Promise<ResultadoDoWebhook> {
  let pedido: unknown;
  try {
    pedido = JSON.parse(corpo);
  } catch {
    // JSON quebrado não melhora na reentrega.
    return { feito: 'corpo_invalido' };
  }

  const id = texto(pedido, 'id');
  if (id === null) return { feito: 'sem_id' };

  const { data: novo, error } = await supabase.rpc('registrar_pedido', {
    p_app_id: appId,
    p_shopify_order_id: id,
    p_source: origemDoPedido(pedido),
    p_total_cents: centavosDoPedido((pedido as { total_price?: unknown }).total_price ?? '0'),
    p_ordered_at: texto(pedido, 'created_at') ?? new Date().toISOString(),
    // `?? undefined` e não `?? null`: o supabase-js não serializa `undefined`,
    // e a função usa o próprio default dela.
    p_order_number: texto(pedido, 'name') ?? texto(pedido, 'order_number') ?? undefined,
    p_currency: texto(pedido, 'currency') ?? undefined,
    p_cart_token: texto(pedido, 'cart_token') ?? undefined,
  });
  if (error != null) throw new Error(error.message);

  return { feito: 'pedido', novo };
}

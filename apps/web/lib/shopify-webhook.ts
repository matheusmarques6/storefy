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
import { ATRIBUTO_DO_CARRINHO, VALOR_DO_ATRIBUTO } from '@storefy/config-schema';
import type { Topico } from '@/lib/shopify';

type Client = SupabaseClient<Database>;

/*
 * O atributo que o app injeta no carrinho vem de `@storefy/config-schema`, que
 * é o contrato painel ⇄ app: o app escreve, a Shopify carrega até o pedido, e
 * este módulo lê. Uma cópia de cada lado se desencontraria no dia em que
 * alguém renomeasse uma — e todo pedido do app viraria pedido do site.
 */
export { ATRIBUTO_DO_CARRINHO, VALOR_DO_ATRIBUTO } from '@storefy/config-schema';

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
  const marca = atributos[ATRIBUTO_DO_CARRINHO];
  return marca === VALOR_DO_ATRIBUTO || marca === 'true' ? 'app' : 'site';
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

  /*
   * `switch` e não `if`, por causa do `default`: todo tópico registrado tem
   * tratamento, e é o TypeScript que garante isso — acrescentar um em
   * `TOPICOS` sem tratá-lo aqui quebra a compilação no `default`, em vez de a
   * loja descobrir em produção. Se um chegar mesmo assim, ACEITAR é a resposta
   * certa: recusar faria a Shopify DESATIVAR o webhook da loja.
   */
  switch (topico) {
    case 'orders/create':
      return await gravarPedido(supabase, app, corpo);
    case 'fulfillments/create':
      return await avisarEnvio(supabase, app, corpo);
    case 'products/update':
      return await avisarDeVolta(supabase, app, corpo);
    default:
      return aceitarSemTratamento(topico);
  }
}

/**
 * `fulfillments/create` — o pedido saiu para entrega.
 *
 * O webhook chega por REMESSA, e não por pedido: três itens em três caixas
 * viram três webhooks. Quem impede três notificações iguais é a trava de
 * `agendar_pedido_enviado`, no banco, onde a corrida entre duas entregas
 * simultâneas também é resolvida.
 */
async function avisarEnvio(
  supabase: Client,
  appId: string,
  corpo: string,
): Promise<ResultadoDoWebhook> {
  let remessa: unknown;
  try {
    remessa = JSON.parse(corpo);
  } catch {
    return { feito: 'corpo_invalido' };
  }

  const pedido = texto(remessa, 'order_id');
  if (pedido === null) return { feito: 'sem_pedido' };

  const { data, error } = await supabase.rpc('agendar_pedido_enviado', {
    p_app_id: appId,
    p_shopify_order_id: pedido,
  });
  if (error != null) throw new Error(error.message);

  return { feito: data ? 'envio_avisado' : 'envio_sem_aviso' };
}

/** Só é alcançada se um tópico novo entrar em `TOPICOS` sem tratamento. */
function aceitarSemTratamento(topico: never): ResultadoDoWebhook {
  const nome: string = topico;
  return { feito: `aceito:${nome}` };
}

/**
 * As variantes DISPONÍVEIS deste produto, pelo payload da Shopify.
 *
 * `inventory_quantity > 0` não basta: a loja que vende sem controlar estoque
 * tem `inventory_management: null` e quantidade zero, e ainda assim está
 * disponível. Quem decide é o mesmo par de campos que o tema usa para desenhar
 * o botão de comprar.
 */
export function variantesDisponiveis(produto: unknown): string[] {
  if (produto === null || typeof produto !== 'object') return [];

  const lista = (produto as { variants?: unknown }).variants;
  if (!Array.isArray(lista)) return [];

  const ids: string[] = [];
  for (const item of lista) {
    if (item === null || typeof item !== 'object') continue;
    const variante = item as {
      id?: unknown;
      inventory_quantity?: unknown;
      inventory_management?: unknown;
      inventory_policy?: unknown;
    };

    const id = texto(variante, 'id');
    if (id === null) continue;

    const controlado =
      typeof variante.inventory_management === 'string' && variante.inventory_management !== '';
    const quantidade =
      typeof variante.inventory_quantity === 'number' ? variante.inventory_quantity : 0;
    const vendeSemEstoque = variante.inventory_policy === 'continue';

    if (!controlado || vendeSemEstoque || quantidade > 0) ids.push(id);
  }
  return ids;
}

/**
 * `products/update` — alguma variante voltou ao estoque?
 *
 * NÃO comparamos com o estoque anterior, e isso é decisão, não atalho: a
 * inscrição é CONSUMIDA no aviso. Quem pediu recebe uma vez e sai da lista, e
 * um `products/update` que chegue de novo com a variante disponível não
 * encontra mais ninguém para avisar. Guardar o estoque de cada variante de
 * cada loja para chegar ao mesmo resultado seria uma tabela nova mantida por
 * webhook — e um estado a mais para ficar errado.
 */
async function avisarDeVolta(
  supabase: Client,
  appId: string,
  corpo: string,
): Promise<ResultadoDoWebhook> {
  let produto: unknown;
  try {
    produto = JSON.parse(corpo);
  } catch {
    return { feito: 'corpo_invalido' };
  }

  const disponiveis = variantesDisponiveis(produto);
  if (disponiveis.length === 0) return { feito: 'sem_variante_disponivel' };

  let avisados = 0;
  for (const variante of disponiveis) {
    const { data, error } = await supabase.rpc('avisar_de_volta', {
      p_app_id: appId,
      p_variant_id: variante,
    });
    if (error != null) throw new Error(error.message);
    avisados += data;
  }

  return { feito: `de_volta:${String(avisados)}` };
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

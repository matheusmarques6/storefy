/**
 * O contrato com a Shopify (seção 8 do plano).
 *
 * Tudo aqui é PURO e testável: montagem de URL, crivo de domínio, leitura de
 * escopos. O que fala com a rede fica em `lib/shopify-servidor.ts`, e o que
 * decide fica aqui — porque é aqui que mora o risco.
 *
 * Nada aqui importa `node:crypto`, e isso é de propósito: a tela de
 * integrações (C14) valida o domínio que o lojista digita com
 * `normalizarDominio`, e um `import` de módulo de servidor num componente de
 * cliente quebra o build inteiro. As duas conferências de assinatura moram em
 * `lib/shopify-assinatura.ts`, que é `server-only`.
 */

/** Cabeçalhos que a Shopify manda em todo webhook. */
export const CABECALHO_DA_ASSINATURA = 'x-shopify-hmac-sha256';
export const CABECALHO_DO_TOPICO = 'x-shopify-topic';
export const CABECALHO_DA_LOJA = 'x-shopify-shop-domain';

/**
 * Os três webhooks que a Shopify EXIGE de todo app público, mais os que o
 * produto usa. Faltando qualquer um dos de privacidade, o app é recusado na
 * revisão da Shopify.
 */
export const TOPICOS_OBRIGATORIOS = [
  'customers/data_request',
  'customers/redact',
  'shop/redact',
  'app/uninstalled',
] as const;

export const TOPICOS_DO_PRODUTO = [
  'orders/create',
  'fulfillments/create',
  'products/update',
] as const;

export const TOPICOS = [...TOPICOS_OBRIGATORIOS, ...TOPICOS_DO_PRODUTO] as const;
export type Topico = (typeof TOPICOS)[number];

export function ehTopicoConhecido(topico: string): topico is Topico {
  return (TOPICOS as readonly string[]).includes(topico);
}

/**
 * O domínio é mesmo de uma loja Shopify?
 *
 * O `shop` chega pela URL, e ele vira o HOST de uma chamada nossa. Sem este
 * crivo, `?shop=evil.com` faria o servidor mandar o segredo do app para onde
 * quem pediu escolheu — é o caminho inteiro de um SSRF, e a Shopify documenta
 * essa validação como obrigatória justamente por isso.
 */
export function ehDominioDeLoja(shop: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop.trim().toLowerCase());
}

/** Normaliza o que o lojista digitou para `minha-loja.myshopify.com`. */
export function normalizarDominio(bruto: string): string | null {
  let texto = bruto.trim().toLowerCase();
  texto = texto.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  // "minha-loja" sozinho é o que o lojista costuma digitar.
  if (/^[a-z0-9][a-z0-9-]*$/.test(texto)) texto = `${texto}.myshopify.com`;
  return ehDominioDeLoja(texto) ? texto : null;
}

export interface PedidoDeAutorizacao {
  shop: string;
  clientId: string;
  escopos: string;
  urlDeRetorno: string;
  /** Aleatório, conferido no retorno. Sem ele, qualquer um inicia a conexão. */
  state: string;
}

/**
 * A URL para onde o lojista é mandado.
 *
 * `grant_options[]=` vazio de propósito: é o que pede um token OFFLINE, que
 * continua valendo depois que o lojista fecha a aba. Um token online morre com
 * a sessão dele, e os nossos webhooks e jobs rodam quando ninguém está olhando.
 */
export function urlDeAutorizacao(pedido: PedidoDeAutorizacao): string {
  const url = new URL(`https://${pedido.shop}/admin/oauth/authorize`);
  url.searchParams.set('client_id', pedido.clientId);
  url.searchParams.set('scope', pedido.escopos);
  url.searchParams.set('redirect_uri', pedido.urlDeRetorno);
  url.searchParams.set('state', pedido.state);
  url.searchParams.set('grant_options[]', '');
  return url.toString();
}

/**
 * Os escopos concedidos cobrem o que pedimos?
 *
 * A Shopify devolve o que o lojista aceitou, que pode ser MENOS do que o
 * pedido quando o app foi reinstalado depois de mudarmos a lista. Descobrir
 * isso na hora da conexão é bem melhor do que descobrir num job que falha
 * silenciosamente de madrugada.
 */
export function faltamEscopos(pedidos: string, concedidos: string): string[] {
  const tem = new Set(
    concedidos
      .split(',')
      .map((escopo) => escopo.trim())
      .filter((escopo) => escopo !== ''),
  );

  return pedidos
    .split(',')
    .map((escopo) => escopo.trim())
    .filter((escopo) => escopo !== '' && !tem.has(escopo));
}

/** A versão da API que o produto fala. Fixa, e trocada de propósito. */
export const VERSAO_DA_API = '2025-07';

/** A URL de um endpoint do Admin API de uma loja. */
export function urlDoAdmin(shop: string, caminho: string): string {
  return `https://${shop}/admin/api/${VERSAO_DA_API}/${caminho.replace(/^\//, '')}`;
}

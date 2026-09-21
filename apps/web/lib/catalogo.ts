/**
 * Buscar produto e coleção na loja do cliente (seletor do composer C08).
 *
 * POR QUE PELA ADMIN API, E NÃO PELA STOREFRONT: o plano cita a Storefront
 * API, que exige um TOKEN A MAIS — outro token, outra tela de configuração,
 * outra coisa para o lojista errar. O token do Admin já está guardado desde o
 * OAuth, e o escopo `read_products` que pedimos já cobre esta busca. Quem
 * consulta é o painel, e não a vitrine, então a Storefront API não traz
 * vantagem nenhuma aqui.
 *
 * Este módulo é PURO: monta a URL e lê a resposta. Quem fala com a rede é
 * `lib/catalogo-servidor.ts`.
 */
import { urlDoAdmin } from '@/lib/shopify';

/** Quantos resultados cabem numa lista sem virar rolagem infinita. */
export const LIMITE_DA_BUSCA = 10;

export type TipoDoItem = 'produto' | 'colecao';

export interface ItemDoCatalogo {
  tipo: TipoDoItem;
  /** Id na Shopify, só para a chave da lista. */
  id: string;
  titulo: string;
  /** O caminho que vira deep link: `/products/<handle>`. */
  caminho: string;
  /** Miniatura, quando a Shopify manda uma. */
  imagem: string | null;
}

/**
 * A URL da busca de produtos.
 *
 * `title` e não `q`: a Admin API REST filtra produto por título, e `q` seria
 * ignorado em silêncio — a busca pareceria quebrada só para quem digita algo
 * que não é o começo de um título.
 */
export function urlDeProdutos(shop: string, termo: string): string {
  const parametros = new URLSearchParams({
    limit: String(LIMITE_DA_BUSCA),
    fields: 'id,title,handle,image,status',
    status: 'active',
  });
  const limpo = termo.trim();
  if (limpo !== '') parametros.set('title', limpo);

  return `${urlDoAdmin(shop, 'products.json')}?${parametros.toString()}`;
}

/** A URL das coleções. A Shopify separa as manuais das automáticas. */
export function urlDeColecoes(shop: string, automaticas: boolean, termo: string): string {
  const parametros = new URLSearchParams({
    limit: String(LIMITE_DA_BUSCA),
    fields: 'id,title,handle,image',
  });
  const limpo = termo.trim();
  if (limpo !== '') parametros.set('title', limpo);

  const recurso = automaticas ? 'smart_collections.json' : 'custom_collections.json';
  return `${urlDoAdmin(shop, recurso)}?${parametros.toString()}`;
}

/**
 * Lê a lista que a Shopify devolveu, sem confiar no formato.
 *
 * Item sem `handle` é DESCARTADO: é o `handle` que vira o caminho, e um item
 * sem ele só poderia virar um link quebrado na notificação de alguém.
 */
export function lerItens(corpo: unknown, chave: string, tipo: TipoDoItem): ItemDoCatalogo[] {
  if (corpo === null || typeof corpo !== 'object') return [];

  const lista = (corpo as Record<string, unknown>)[chave];
  if (!Array.isArray(lista)) return [];

  const itens: ItemDoCatalogo[] = [];
  for (const bruto of lista) {
    if (bruto === null || typeof bruto !== 'object') continue;
    const item = bruto as { id?: unknown; title?: unknown; handle?: unknown; image?: unknown };

    const handle = typeof item.handle === 'string' ? item.handle.trim() : '';
    if (handle === '') continue;

    itens.push({
      tipo,
      id: idComoTexto(item.id),
      titulo: typeof item.title === 'string' && item.title !== '' ? item.title : handle,
      caminho: caminhoDoItem(tipo, handle),
      imagem: leituraDaImagem(item.image),
    });
  }
  return itens;
}

/** `/products/<handle>` ou `/collections/<handle>`. */
export function caminhoDoItem(tipo: TipoDoItem, handle: string): string {
  return tipo === 'produto' ? `/products/${handle}` : `/collections/${handle}`;
}

function idComoTexto(id: unknown): string {
  if (typeof id === 'number') return String(id);
  return typeof id === 'string' ? id : '';
}

/**
 * A URL da miniatura, só se for https.
 *
 * A imagem vai para um `<img>` no painel. Um `javascript:` ou um `data:` ali
 * viria da resposta de um servidor que não é nosso — e a resposta é da loja do
 * cliente, que instalou os apps que quis.
 */
function leituraDaImagem(imagem: unknown): string | null {
  if (imagem === null || typeof imagem !== 'object') return null;
  const src = (imagem as { src?: unknown }).src;
  if (typeof src !== 'string') return null;
  return src.startsWith('https://') ? src : null;
}

/** Junta produtos e coleções na ordem em que a tela mostra. */
export function montarResultados(
  produtos: ItemDoCatalogo[],
  colecoes: ItemDoCatalogo[],
): ItemDoCatalogo[] {
  // Produto primeiro: é o que o lojista quer mandar em nove de cada dez
  // campanhas, e a coleção é o caso do "toda a linha de inverno".
  return [...produtos, ...colecoes].slice(0, LIMITE_DA_BUSCA * 2);
}

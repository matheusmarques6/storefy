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
 * Este módulo é PURO: monta a consulta e lê a resposta. Quem fala com a rede
 * é `lib/catalogo-servidor.ts`.
 */

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
 * Produtos ativos e coleções, numa ida só à GraphQL da Shopify. A API REST
 * que isto usava é legado para a Shopify (app público novo usa só GraphQL),
 * e fazia três chamadas: produtos, coleções manuais e automáticas.
 */
export const CONSULTA_DO_CATALOGO = `query Catalogo($limite: Int!, $produtos: String!, $colecoes: String!) {
  products(first: $limite, query: $produtos, sortKey: TITLE) {
    nodes { id title handle featuredMedia { preview { image { url } } } }
  }
  collections(first: $limite, query: $colecoes, sortKey: TITLE) {
    nodes { id title handle image { url } }
  }
}`;

/** Palavras demais não afinam a busca, só a esvaziam. */
const PALAVRAS_DA_BUSCA = 5;

/**
 * As buscas na sintaxe da Shopify, a partir do que o lojista digitou.
 *
 * Cada palavra vira `title:palavra*`: acha o título que tem uma palavra
 * começando por ela, em qualquer posição — "azul" acha "Camiseta azul". E
 * o que não é letra, número ou hífen SAI: a sintaxe da busca tem operadores
 * (`:`, aspas, parênteses, `-` no começo), e o texto digitado não pode virar
 * filtro.
 */
export function buscasDoCatalogo(termo: string): { produtos: string; colecoes: string } {
  const palavras = termo
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map((palavra) => palavra.replace(/^-+/, ''))
    .filter((palavra) => palavra !== '')
    .slice(0, PALAVRAS_DA_BUSCA);
  const titulo = palavras.map((palavra) => `title:${palavra}*`).join(' ');
  return {
    produtos: titulo === '' ? 'status:active' : `status:active ${titulo}`,
    colecoes: titulo,
  };
}

/**
 * Lê a resposta da consulta, sem confiar no formato.
 *
 * Item sem `handle` é DESCARTADO: é o `handle` que vira o caminho, e um item
 * sem ele só poderia virar um link quebrado na notificação de alguém.
 */
export function lerCatalogo(dados: Record<string, unknown>): ItemDoCatalogo[] {
  const produtos = nosDa(dados.products).flatMap((no) => {
    const midia = no.featuredMedia as {
      preview?: { image?: { url?: unknown } | null } | null;
    } | null;
    const item = itemDo(no, 'produto', midia?.preview?.image?.url);
    return item === null ? [] : [item];
  });
  const colecoes = nosDa(dados.collections).flatMap((no) => {
    const imagem = no.image as { url?: unknown } | null;
    const item = itemDo(no, 'colecao', imagem?.url);
    return item === null ? [] : [item];
  });
  return montarResultados(produtos, colecoes);
}

function nosDa(conexao: unknown): Record<string, unknown>[] {
  if (conexao === null || typeof conexao !== 'object') return [];
  const nos = (conexao as { nodes?: unknown }).nodes;
  if (!Array.isArray(nos)) return [];
  return nos.filter((no): no is Record<string, unknown> => no !== null && typeof no === 'object');
}

function itemDo(
  no: Record<string, unknown>,
  tipo: TipoDoItem,
  imagem: unknown,
): ItemDoCatalogo | null {
  const handle = typeof no.handle === 'string' ? no.handle.trim() : '';
  if (handle === '') return null;
  return {
    tipo,
    id: typeof no.id === 'string' ? no.id : '',
    titulo: typeof no.title === 'string' && no.title !== '' ? no.title : handle,
    caminho: caminhoDoItem(tipo, handle),
    imagem: imagemSegura(imagem),
  };
}

/** `/products/<handle>` ou `/collections/<handle>`. */
export function caminhoDoItem(tipo: TipoDoItem, handle: string): string {
  return tipo === 'produto' ? `/products/${handle}` : `/collections/${handle}`;
}

/**
 * A URL da miniatura, só se for https.
 *
 * A imagem vai para um `<img>` no painel. Um `javascript:` ou um `data:` ali
 * viria da resposta de um servidor que não é nosso — e a resposta é da loja do
 * cliente, que instalou os apps que quis.
 */
function imagemSegura(url: unknown): string | null {
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
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

import 'server-only';

/**
 * Ler a página inicial da loja (C02 e C03).
 *
 * É o que a detecção de nome, cor e logo lê, e o que o "usar o logo do site"
 * relê para achar a imagem. Sai do NOSSO servidor para um endereço que alguém
 * digitou, então passa pela busca pública — cada redirecionamento conferido,
 * com teto de tempo e de tamanho.
 */
import { buscarPublico, type FalhaDaBusca } from '@/lib/busca-publica';
import { temaDaShopify } from '@/lib/deteccao-da-loja';

/** A loja pode demorar; o cadastro não pode ficar pendurado nela. */
export const TEMPO_LIMITE_DA_LEITURA_MS = 8000;
/** Teto do documento lido. Página inicial de loja passa longe disso. */
const TAMANHO_MAXIMO_DA_PAGINA = 2 * 1024 * 1024;

export const AGENTE_DA_STOREFY =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 StorefyBot';

export type PaginaDaLoja =
  { ok: true; html: string; url: URL } | { ok: false; motivo: string; falha: FalhaDaBusca };

/** A falha da busca, dita ao lojista. */
export function motivoDaFalha(falha: FalhaDaBusca, status?: number): string {
  switch (falha) {
    case 'host':
      return 'Este endereço não pode ser consultado.';
    case 'status':
      return status === undefined
        ? 'A loja respondeu com erro. Confira o endereço.'
        : `A loja respondeu com erro ${String(status)}. Confira o endereço.`;
    case 'grande':
      return 'A página inicial da loja é grande demais para analisarmos.';
    case 'saltos':
    case 'rede':
      return 'Não conseguimos acessar a loja agora. Confira o endereço ou preencha à mão.';
  }
}

export async function lerPaginaDaLoja(url: URL, buscador?: typeof fetch): Promise<PaginaDaLoja> {
  const lida = await buscarPublico(url, {
    aceitar: 'text/html,application/xhtml+xml',
    tamanhoMaximo: TAMANHO_MAXIMO_DA_PAGINA,
    tempoLimiteMs: TEMPO_LIMITE_DA_LEITURA_MS,
    agente: AGENTE_DA_STOREFY,
    ...(buscador === undefined ? {} : { buscador }),
  });
  if (!lida.ok) {
    return { ok: false, motivo: motivoDaFalha(lida.falha, lida.status), falha: lida.falha };
  }
  return { ok: true, html: new TextDecoder('utf-8').decode(lida.corpo), url: lida.urlFinal };
}

/** `/products.json` é público em toda loja Shopify e devolve uma lista. */
export async function confirmarShopify(base: URL, buscador?: typeof fetch): Promise<boolean> {
  const lida = await buscarPublico(new URL('/products.json?limit=1', base), {
    aceitar: 'application/json',
    tamanhoMaximo: TAMANHO_MAXIMO_DA_PAGINA,
    tempoLimiteMs: TEMPO_LIMITE_DA_LEITURA_MS,
    agente: AGENTE_DA_STOREFY,
    ...(buscador === undefined ? {} : { buscador }),
  });
  if (!lida.ok) return false;
  try {
    const corpo: unknown = JSON.parse(new TextDecoder('utf-8').decode(lida.corpo));
    return (
      typeof corpo === 'object' &&
      corpo !== null &&
      Array.isArray((corpo as { products?: unknown }).products)
    );
  } catch {
    return false;
  }
}

export type TemaDescoberto = { ok: true; tema: string } | { ok: false; motivo: string };

/**
 * Lê o tema da Shopify na página inicial da loja (A10), quando o lojista pede
 * no editor — para a loja cadastrada antes da detecção, ou que trocou de tema.
 */
export async function descobrirTema(url: URL, buscador?: typeof fetch): Promise<TemaDescoberto> {
  const pagina = await lerPaginaDaLoja(url, buscador);
  if (!pagina.ok) {
    // No editor não há campo para "preencher à mão", como no cadastro.
    return {
      ok: false,
      motivo:
        pagina.falha === 'rede' || pagina.falha === 'saltos'
          ? 'Não conseguimos acessar a loja agora. Confira se o site está no ar e tente de novo.'
          : pagina.motivo,
    };
  }
  const tema = temaDaShopify(pagina.html);
  if (tema === null) {
    return {
      ok: false,
      motivo:
        'A página da loja não diz qual é o tema. Escolha o preset pelo nome do tema, que aparece na Shopify em Loja virtual › Temas.',
    };
  }
  return { ok: true, tema };
}

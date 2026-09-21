import 'server-only';

/**
 * A busca no catálogo da loja, pela Admin API da Shopify.
 *
 * O token nunca sai daqui: ele é lido cifrado pela service role, aberto em
 * memória e usado no cabeçalho da chamada. O painel recebe título, caminho e
 * miniatura — e nada mais.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { ehDominioDeLoja } from '@/lib/shopify';
import { tokenDaLoja } from '@/lib/shopify-conexao';
import {
  lerItens,
  montarResultados,
  urlDeColecoes,
  urlDeProdutos,
  type ItemDoCatalogo,
} from '@/lib/catalogo';

type Client = SupabaseClient<Database>;

const TIMEOUT_MS = 10_000;

export type ResultadoDaBusca =
  | { ok: true; itens: ItemDoCatalogo[] }
  /** Motivo em pt-BR, pronto para a tela. */
  | { ok: false; motivo: string; desconectada?: boolean };

/**
 * Busca produtos e coleções da loja.
 *
 * `servico` é o client da SERVICE ROLE: a coluna do token é invisível para o
 * client da sessão por `grant` de coluna, e essa é justamente a proteção que
 * não se contorna "só desta vez".
 */
export async function buscarNoCatalogo(
  servico: Client,
  storeId: string,
  termo: string,
  buscador: typeof fetch = fetch,
): Promise<ResultadoDaBusca> {
  /*
   * `tokenDaLoja` RENOVA o token se ele estiver perto de vencer. É por isso
   * que a leitura não é feita aqui: a conexão pelo app do próprio lojista dá
   * um token de 24 horas, e ler a coluna direto significaria a busca falhar
   * um dia depois de conectar, com o lojista digitando na tela.
   */
  const conexao = await tokenDaLoja(servico, storeId, buscador);
  if (!conexao.ok) {
    return { ok: false, motivo: conexao.motivo, desconectada: conexao.reconectar };
  }

  const { token, dominio } = conexao;

  if (!ehDominioDeLoja(dominio)) {
    return {
      ok: false,
      motivo: 'Conecte a Shopify para escolher um produto ou uma coleção.',
      desconectada: true,
    };
  }

  /*
   * As três chamadas em paralelo: a Shopify separa coleção manual de coleção
   * automática em recursos diferentes, e fazer uma de cada vez triplicaria a
   * espera de quem está digitando.
   */
  const [produtos, manuais, automaticas] = await Promise.all([
    pedir(buscador, urlDeProdutos(dominio, termo), token),
    pedir(buscador, urlDeColecoes(dominio, false, termo), token),
    pedir(buscador, urlDeColecoes(dominio, true, termo), token),
  ]);

  if (produtos === 'revogado' || manuais === 'revogado' || automaticas === 'revogado') {
    return {
      ok: false,
      motivo: 'A Shopify recusou a conexão. Reconecte a loja para continuar.',
      desconectada: true,
    };
  }

  if (produtos === null && manuais === null && automaticas === null) {
    return { ok: false, motivo: 'Não conseguimos falar com a Shopify agora. Tente de novo.' };
  }

  const corpoDe = (resposta: RespostaDaShopify): unknown =>
    resposta === null || resposta === 'revogado' ? null : resposta.corpo;

  return {
    ok: true,
    itens: montarResultados(lerItens(corpoDe(produtos), 'products', 'produto'), [
      ...lerItens(corpoDe(manuais), 'custom_collections', 'colecao'),
      ...lerItens(corpoDe(automaticas), 'smart_collections', 'colecao'),
    ]),
  };
}

/** O corpo da resposta, `null` em falha, `'revogado'` quando o token morreu. */
type RespostaDaShopify = { corpo: unknown } | null | 'revogado';

async function pedir(
  buscador: typeof fetch,
  url: string,
  token: string,
): Promise<RespostaDaShopify> {
  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  try {
    const resposta = await buscador(url, {
      headers: { 'X-Shopify-Access-Token': token, Accept: 'application/json' },
      signal: controle.signal,
    });

    /*
     * 401 e 403 são o token revogado ou sem o escopo: a tela precisa dizer
     * "reconecte", e não "tente de novo" — tentar de novo daria no mesmo para
     * sempre.
     */
    if (resposta.status === 401 || resposta.status === 403) return 'revogado';
    if (!resposta.ok) return null;

    return { corpo: await resposta.json() };
  } catch {
    return null;
  } finally {
    clearTimeout(relogio);
  }
}

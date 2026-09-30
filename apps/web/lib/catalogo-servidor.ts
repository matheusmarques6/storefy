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
import { consultarAdmin } from '@/lib/shopify-servidor';
import {
  CONSULTA_DO_CATALOGO,
  LIMITE_DA_BUSCA,
  buscasDoCatalogo,
  lerCatalogo,
  type ItemDoCatalogo,
} from '@/lib/catalogo';

type Client = SupabaseClient<Database>;

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

  // Produtos e coleções numa consulta só: quem está digitando espera uma ida, e não três.
  const resposta = await consultarAdmin(
    dominio,
    token,
    CONSULTA_DO_CATALOGO,
    { limite: LIMITE_DA_BUSCA, ...buscasDoCatalogo(termo) },
    buscador,
  );

  if (!resposta.ok) {
    /*
     * Token revogado ou sem o escopo: a tela precisa dizer "reconecte", e não
     * "tente de novo" — tentar de novo daria no mesmo para sempre.
     */
    return resposta.causa === 'sem-permissao'
      ? {
          ok: false,
          motivo: 'A Shopify recusou a conexão. Reconecte a loja para continuar.',
          desconectada: true,
        }
      : { ok: false, motivo: 'Não conseguimos falar com a Shopify agora. Tente de novo.' };
  }

  return { ok: true, itens: lerCatalogo(resposta.dados) };
}

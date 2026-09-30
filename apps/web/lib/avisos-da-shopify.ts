import 'server-only';

/**
 * Os avisos (webhooks) da Shopify de cada loja: conferidos, refeitos e
 * guardados (C14).
 *
 * Eles eram registrados uma vez, na conexão, e ninguém olhava de novo. Só que
 * a Shopify APAGA a inscrição depois de entregas que falham seguidas — a
 * Storefy fora do ar por algumas horas basta —, e o aviso que não se registrou
 * na conexão também ficava para trás. Sem `orders/create` a loja para de
 * contar as vendas pelo app; sem `products/update`, o "me avise quando
 * voltar" nunca avisa. Em silêncio, com a tela dizendo "conectada".
 *
 * Aqui a loja é conferida na Shopify, o que falta é registrado de novo, e o
 * resultado fica na loja: é o que a C14, a A04 e o job leem.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { urlDoSite } from '@/lib/env';
import { log } from '@/lib/log';
import { ehDominioDeLoja, TOPICOS_DA_LOJA, type TopicoDaLoja } from '@/lib/shopify';
import { tokenDaLoja } from '@/lib/shopify-conexao';
import { registrarWebhooks, type ResultadoDosWebhooks } from '@/lib/shopify-servidor';

type Client = SupabaseClient<Database>;

const SEM_RESPOSTA = 'A Shopify não respondeu agora. Tente de novo em alguns minutos.';

export type ConferenciaDosAvisos =
  { ok: true; faltando: TopicoDaLoja[]; acessoRecusado: boolean } | { ok: false; motivo: string };

/** O endereço que todos os avisos da Storefy usam. */
export function urlDosAvisos(): string {
  return `${urlDoSite()}/api/webhooks/shopify`;
}

/**
 * Guarda o que a conexão, ou a conferência, achou. A Shopify que não
 * respondeu não é guardada: não se sabe o que falta, e "faltam todos" seria
 * alarme falso na tela do lojista.
 */
export async function guardarAvisos(
  servico: Client,
  storeId: string,
  resultado: ResultadoDosWebhooks,
): Promise<void> {
  if (resultado.semResposta) return;
  const agora = new Date().toISOString();
  const { error } = await servico
    .from('stores')
    .update({
      shopify_avisos_faltando: resultado.falharam,
      shopify_avisos_conferidos_em: agora,
      shopify_acesso_recusado_em: resultado.acessoRecusado ? agora : null,
    })
    .eq('id', storeId);
  // A conferência seguinte grava de novo; a falha precisa aparecer para a equipe.
  if (error != null) log.erro('shopify.avisos-nao-guardados', { loja: storeId, falha: error });
}

/**
 * Confere os avisos da loja na Shopify, refaz os que faltam e guarda o
 * resultado.
 *
 * Credencial que não serve mais (token ilegível, renovação recusada) conta
 * como acesso recusado: só conectar de novo resolve, e é isso que a tela diz.
 */
export async function conferirAvisosDaLoja(
  servico: Client,
  storeId: string,
  buscador: typeof fetch = fetch,
): Promise<ConferenciaDosAvisos> {
  const conexao = await tokenDaLoja(servico, storeId, buscador);
  if (!conexao.ok) {
    if (!conexao.reconectar) return { ok: false, motivo: conexao.motivo };
    const recusado: ResultadoDosWebhooks = {
      registrados: [],
      falharam: [...TOPICOS_DA_LOJA],
      acessoRecusado: true,
      semResposta: false,
    };
    await guardarAvisos(servico, storeId, recusado);
    return { ok: true, faltando: recusado.falharam, acessoRecusado: true };
  }
  if (!ehDominioDeLoja(conexao.dominio)) {
    return { ok: false, motivo: 'O endereço da loja na Shopify não é válido. Reconecte a loja.' };
  }

  const resultado = await registrarWebhooks(
    conexao.dominio,
    conexao.token,
    urlDosAvisos(),
    buscador,
  );
  if (resultado.semResposta) return { ok: false, motivo: SEM_RESPOSTA };

  await guardarAvisos(servico, storeId, resultado);
  return { ok: true, faltando: resultado.falharam, acessoRecusado: resultado.acessoRecusado };
}

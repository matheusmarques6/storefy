import 'server-only';

/**
 * A cobrança vista pelo servidor: a situação da empresa (do banco, que é quem
 * decide) e o cancelamento — que passa pela Asaas ANTES de ser gravado, para
 * nunca existir "cancelada aqui, cobrando lá".
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { cancelarAssinatura } from '@/lib/asaas';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import type { SituacaoDaCobranca } from '@/lib/cobranca';
import { log } from '@/lib/log';

export type { SituacaoDaCobranca } from '@/lib/cobranca';

type Cliente = SupabaseClient<Database>;

export interface UsoDaEmpresa {
  lojas: number;
  aparelhos30d: number;
  campanhasNoMes: number;
}

/** A situação da cobrança, como o banco a calcula. Lança se não conseguir ler. */
export async function lerSituacaoDaCobranca(
  supabase: Cliente,
  orgId: string,
): Promise<SituacaoDaCobranca> {
  const { data, error } = await supabase.rpc('situacao_da_cobranca', { p_org_id: orgId });
  const linha = data?.[0];
  if (error != null || linha == null) {
    throw new Error(
      `Não foi possível ler a cobrança da empresa: ${error?.message ?? 'sem resposta'}`,
    );
  }
  return {
    emDia: linha.em_dia === true,
    liberadoAte: linha.liberado_ate,
    testeAte: linha.teste_ate ?? '',
    assinatura: linha.assinatura,
    planoId: linha.plano_id,
    planoNome: linha.plano_nome,
    valorCentavos: linha.valor_centavos,
    pagoAte: linha.pago_ate,
    inadimplenteDesde: linha.inadimplente_desde,
    canceladaEm: linha.cancelada_em,
    limitesDoTeste: linha.limites_do_teste === true,
    limiteLojas: linha.limite_lojas,
    limiteAparelhos: linha.limite_aparelhos,
    limiteCampanhasMes: linha.limite_campanhas_mes,
    hoje: linha.hoje ?? '',
  };
}

export async function lerUsoDaEmpresa(supabase: Cliente, orgId: string): Promise<UsoDaEmpresa> {
  const { data, error } = await supabase.rpc('uso_da_org', { p_org_id: orgId });
  const linha = data?.[0];
  if (error != null || linha == null) {
    throw new Error(`Não foi possível ler o uso da empresa: ${error?.message ?? 'sem resposta'}`);
  }
  return {
    lojas: linha.lojas ?? 0,
    aparelhos30d: linha.aparelhos_30d ?? 0,
    campanhasNoMes: linha.campanhas_no_mes ?? 0,
  };
}

/** Os aparelhos ativos (30 dias) de cada loja, na ordem em que foram criadas. */
export async function lerAparelhosPorLoja(
  supabase: Cliente,
  orgId: string,
): Promise<{ lojaId: string; nome: string; aparelhos30d: number }[]> {
  const { data, error } = await supabase.rpc('aparelhos_por_loja', { p_org_id: orgId });
  if (error != null) {
    throw new Error(`Não foi possível ler os aparelhos por loja: ${error.message}`);
  }
  return data.map((linha) => ({
    lojaId: linha.store_id ?? '',
    nome: linha.nome ?? '',
    aparelhos30d: linha.aparelhos_30d ?? 0,
  }));
}

/**
 * Cancela a assinatura da empresa: primeiro na Asaas, depois aqui.
 *
 * Sem assinatura viva, não há o que cancelar e está tudo certo. Se a Asaas
 * não responder, NADA muda aqui — quem chama mostra o motivo e a pessoa tenta
 * de novo; gravar "cancelada" com a cobrança ainda saindo seria o pior dos
 * dois mundos.
 */
export async function cancelarAssinaturaDaEmpresa(
  orgId: string,
  ator: string,
): Promise<{ ok: true; cancelou: boolean } | { ok: false; motivo: string }> {
  const servico = criarClientServiceRole();
  const { data: assinatura, error } = await servico
    .from('subscriptions')
    .select('external_id, cancelada_em')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error != null) {
    log.erro('cobranca.assinatura-nao-lida', { falha: error });
    return { ok: false, motivo: 'Não conseguimos ler a assinatura. Tente de novo.' };
  }
  if (assinatura == null || assinatura.cancelada_em != null) return { ok: true, cancelou: false };

  const naAsaas = await cancelarAssinatura(assinatura.external_id);
  if (!naAsaas.ok) return { ok: false, motivo: naAsaas.motivo };

  const { error: erroAqui } = await servico.rpc('encerrar_assinatura', {
    p_provider: 'asaas',
    p_assinatura: assinatura.external_id,
    p_ator: ator,
  });
  if (erroAqui != null) {
    // Cancelada na Asaas e não gravada aqui: o aviso SUBSCRIPTION_DELETED da
    // própria Asaas grava depois. O log é para a equipe conferir se não veio.
    log.erro('cobranca.cancelada-na-asaas-nao-gravada', { org: orgId, falha: erroAqui });
    return {
      ok: false,
      motivo:
        'A assinatura foi cancelada, mas a tela ainda não atualizou. Recarregue em instantes.',
    };
  }
  return { ok: true, cancelou: true };
}

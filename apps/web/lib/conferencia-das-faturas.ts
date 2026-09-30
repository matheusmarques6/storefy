import 'server-only';

/**
 * As faturas de uma assinatura conferidas direto na Asaas (C15, A04 e o job
 * `invoice-sync`).
 *
 * O caminho normal de uma fatura é o aviso (webhook) da Asaas, e ele falha em
 * silêncio: a Asaas PAUSA a fila depois de erros seguidos. Cada aviso perdido
 * deixa uma marca — a fatura paga continua "vencida" (e quem pagou é travado
 * depois da tolerância), a fatura nova não aparece para ser paga, a removida
 * continua cobrando. Aqui a Asaas é lida, e o que ela diz é gravado pelo mesmo
 * `registrar_fatura` do aviso — que nunca desfaz uma fatura paga.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { faturaDaAsaas, faturasDaAssinatura } from '@/lib/asaas';
import { centavosDaAsaas, situacaoDaFatura } from '@/lib/cobranca';
import { log } from '@/lib/log';

type Client = SupabaseClient<Database>;
type SituacaoDaFatura = Database['public']['Enums']['invoice_status'];

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const SEM_LEITURA = 'Não conseguimos ler as faturas agora. Tente de novo em instantes.';

export interface FaturaConferida {
  id: string;
  situacao: SituacaoDaFatura;
  valorCentavos: number;
  vencimento: string;
  pagaEm: string | null;
  link: string | null;
}

export type ResultadoDaConferencia =
  | { ok: false; motivo: string }
  | {
      ok: true;
      /** O que a Asaas disse, na nossa língua. */
      faturas: FaturaConferida[];
      /** Em aberto aqui, e paga na Asaas: o pagamento cujo aviso não chegou. */
      pagasAgora: number;
      /** A Asaas disse, e o banco não gravou: a próxima conferência tenta de novo. */
      naoGravadas: number;
    };

/** Uma cobrança da API na nossa língua, ou `null` quando não dá para gravar. */
function conferida(fatura: {
  id: string;
  value: number;
  status: string;
  dueDate: string;
  invoiceUrl: string | null;
  clientPaymentDate: string | null;
  paymentDate: string | null;
  deleted: boolean;
}): FaturaConferida | null {
  // Removida na Asaas não se paga mais, qualquer que seja o status que ficou.
  const situacao = fatura.deleted ? 'canceled' : situacaoDaFatura(fatura.status);
  if (situacao === null || !DIA.test(fatura.dueDate)) return null;
  const pagaEm = fatura.clientPaymentDate ?? fatura.paymentDate;
  return {
    id: fatura.id,
    situacao,
    valorCentavos: centavosDaAsaas(fatura.value),
    vencimento: fatura.dueDate,
    pagaEm: situacao === 'paid' && pagaEm !== null && DIA.test(pagaEm) ? pagaEm : null,
    // Como no aviso: o link vira `href` na tela, e só endereço web atravessa.
    link:
      fatura.invoiceUrl !== null && /^https?:\/\//.test(fatura.invoiceUrl)
        ? fatura.invoiceUrl
        : null,
  };
}

/**
 * Lê as faturas da assinatura na Asaas e grava o que mudou.
 *
 * A lista da assinatura traz as mais recentes. A fatura que está em aberto
 * AQUI e não veio nela é lida pelo id: removida na Asaas (o aviso de remoção
 * se perdeu), ela fecha como cancelada — senão travaria a empresa para sempre.
 */
export async function conferirFaturas(
  servico: Client,
  assinatura: string,
  buscador: typeof fetch = fetch,
): Promise<ResultadoDaConferencia> {
  const lidas = await faturasDaAssinatura(assinatura, buscador);
  if (!lidas.ok) return { ok: false, motivo: lidas.motivo };

  const { data: nossas, error: erroDasNossas } = await servico
    .from('invoices')
    .select('external_id, status, valor_centavos, vencimento')
    .eq('provider', 'asaas')
    .eq('assinatura_externa', assinatura);
  if (erroDasNossas != null) {
    log.erro('cobranca.conferencia-sem-leitura', { assinatura, falha: erroDasNossas });
    return { ok: false, motivo: SEM_LEITURA };
  }

  const faturas = lidas.dados.map(conferida).filter((fatura) => fatura !== null);
  const naLista = new Set(lidas.dados.map((fatura) => fatura.id));

  for (const nossa of nossas) {
    const aberta = nossa.status === 'pending' || nossa.status === 'overdue';
    if (!aberta || naLista.has(nossa.external_id)) continue;

    const lida = await faturaDaAsaas(nossa.external_id, buscador);
    if (!lida.ok) return { ok: false, motivo: lida.motivo };
    const fatura =
      lida.dados === null
        ? // A Asaas não a tem mais: removida.
          {
            id: nossa.external_id,
            situacao: 'canceled' as const,
            valorCentavos: nossa.valor_centavos,
            vencimento: nossa.vencimento,
            pagaEm: null,
            link: null,
          }
        : conferida(lida.dados);
    if (fatura !== null) faturas.push(fatura);
  }

  const antes = new Map(nossas.map((nossa) => [nossa.external_id, nossa.status]));
  let pagasAgora = 0;
  let naoGravadas = 0;

  for (const fatura of faturas) {
    const { error } = await servico.rpc('registrar_fatura', {
      p_provider: 'asaas',
      p_fatura: fatura.id,
      p_assinatura: assinatura,
      p_valor_centavos: fatura.valorCentavos,
      p_status: fatura.situacao,
      p_vencimento: fatura.vencimento,
      ...(fatura.pagaEm === null ? {} : { p_paga_em: fatura.pagaEm }),
      ...(fatura.link === null ? {} : { p_link: fatura.link }),
    });
    if (error != null) {
      naoGravadas += 1;
      log.erro('cobranca.conferencia-nao-gravada', { fatura: fatura.id, falha: error });
      continue;
    }
    const anterior = antes.get(fatura.id);
    if (fatura.situacao === 'paid' && (anterior === 'pending' || anterior === 'overdue')) {
      pagasAgora += 1;
    }
  }

  // Só com tudo gravado: a que ficou pela metade volta para o começo da fila do job.
  if (naoGravadas === 0) {
    const { error: erroDaMarca } = await servico
      .from('subscriptions')
      .update({ conferida_em: new Date().toISOString() })
      .eq('provider', 'asaas')
      .eq('external_id', assinatura);
    if (erroDaMarca != null) {
      log.erro('cobranca.conferencia-sem-marca', { assinatura, falha: erroDaMarca });
    }
  }

  return { ok: true, faturas, pagasAgora, naoGravadas };
}

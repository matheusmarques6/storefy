/**
 * `GET /api/jobs/invoice-sync` — as faturas conferidas direto na Asaas.
 *
 * O caminho normal de uma fatura é o aviso (webhook) da Asaas, e ele falha em
 * silêncio: a Asaas PAUSA a fila depois de erros seguidos, e cada aviso
 * perdido é uma fatura paga que continua "vencida" (quem pagou é travado
 * depois da tolerância), uma nova que não aparece ou uma removida que segue
 * cobrando. De hora em hora, este job confere algumas assinaturas — a que foi
 * conferida há mais tempo primeiro, e nenhuma mais de uma vez a cada 6 horas.
 *
 * Sem a Asaas configurada não há assinatura para conferir: o job anota que
 * rodou e sai.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { cobrancaConfigurada } from '@/lib/asaas';
import { conferirFaturas } from '@/lib/conferencia-das-faturas';
import { CABECALHO_DO_CRON, autorizarJob, registrarBatimento } from '@/lib/jobs';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SEM_CACHE = { 'Cache-Control': 'no-store' } as const;

/** Assinaturas por execução: cada uma é uma ida (ou mais) à Asaas. */
const POR_EXECUCAO = 20;
/** Uma assinatura conferida não volta antes disto. */
const HORAS_ENTRE_CONFERENCIAS = 6;
/**
 * O tempo que o job se dá. Uma Asaas lenta (15 s por chamada) estouraria o
 * `maxDuration`, e o job morto não anota o batimento: para antes, e a próxima
 * execução continua de onde esta parou.
 */
const ORCAMENTO_MS = 40_000;

export async function GET(requisicao: NextRequest): Promise<NextResponse> {
  const autorizacao = autorizarJob(
    requisicao.headers.get(CABECALHO_DO_CRON),
    process.env.CRON_SECRET,
  );
  if (!autorizacao.ok) {
    log.aviso('job-faturas.recusado', { motivo: autorizacao.motivo });
    return NextResponse.json(
      { erro: 'nao_autorizado' },
      { status: autorizacao.status, headers: SEM_CACHE },
    );
  }

  if (!supabaseConfigurado || !serviceRoleConfigurada) {
    return NextResponse.json(
      { erro: 'servidor_nao_configurado' },
      { status: 503, headers: SEM_CACHE },
    );
  }

  const inicio = Date.now();
  if (!cobrancaConfigurada()) {
    await registrarBatimento('invoice-sync', inicio);
    return NextResponse.json(
      { ok: true, ignorado: 'cobranca_nao_configurada' },
      { headers: SEM_CACHE },
    );
  }

  let conferidas = 0;
  let pagasAgora = 0;
  let falhas = 0;
  try {
    const servico = criarClientServiceRole();
    const limite = new Date(inicio - HORAS_ENTRE_CONFERENCIAS * 3_600_000).toISOString();
    const { data: assinaturas, error } = await servico
      .from('subscriptions')
      .select('external_id')
      .eq('provider', 'asaas')
      .is('cancelada_em', null)
      .or(`conferida_em.is.null,conferida_em.lt.${limite}`)
      .order('conferida_em', { ascending: true, nullsFirst: true })
      .limit(POR_EXECUCAO);
    if (error != null) throw new Error(error.message);

    for (const assinatura of assinaturas) {
      if (Date.now() - inicio > ORCAMENTO_MS) break;
      const conferencia = await conferirFaturas(servico, assinatura.external_id);
      if (!conferencia.ok || conferencia.naoGravadas > 0) {
        falhas += 1;
        log.aviso('job-faturas.assinatura-nao-conferida', {
          assinatura: assinatura.external_id,
          motivo: conferencia.ok ? 'faturas não gravadas' : conferencia.motivo,
        });
        continue;
      }
      conferidas += 1;
      pagasAgora += conferencia.pagasAgora;
    }

    if (pagasAgora > 0) log.info('job-faturas.pagamentos-recuperados', { pagasAgora });
    // Nenhuma conferida e alguma falhou: é a Asaas (ou a chave), e a equipe precisa saber.
    if (falhas > 0 && conferidas === 0) {
      throw new Error(`Nenhuma assinatura conferida: ${String(falhas)} falharam.`);
    }

    await registrarBatimento('invoice-sync', inicio);
    return NextResponse.json({ ok: true, conferidas, pagasAgora, falhas }, { headers: SEM_CACHE });
  } catch (erro) {
    log.erro('job-faturas.falhou', { erro });
    await registrarBatimento('invoice-sync', inicio, erro);
    return NextResponse.json(
      { erro: 'indisponivel', conferidas, falhas },
      { status: 500, headers: SEM_CACHE },
    );
  }
}

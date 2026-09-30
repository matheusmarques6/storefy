/**
 * `GET /api/jobs/shopify-webhooks` — os avisos da Shopify de cada loja,
 * conferidos e refeitos.
 *
 * A Shopify APAGA a inscrição de um aviso depois de entregas que falham
 * seguidas — a Storefy fora do ar por algumas horas basta —, e daí em diante a
 * loja para de contar as vendas pelo app, e o "me avise" e o aviso de envio
 * param de sair. Em silêncio: nada quebra na tela. De hora em hora, este job
 * confere algumas lojas conectadas — a conferida há mais tempo primeiro, e
 * nenhuma mais de uma vez a cada 12 horas —, refaz o que falta e guarda o que
 * achou, para a C14 e a A04 mostrarem.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criptografiaConfigurada } from '@/lib/cripto';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { conferirAvisosDaLoja } from '@/lib/avisos-da-shopify';
import { CABECALHO_DO_CRON, autorizarJob, registrarBatimento } from '@/lib/jobs';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SEM_CACHE = { 'Cache-Control': 'no-store' } as const;

/** Lojas por execução: cada uma são algumas chamadas à Shopify. */
const POR_EXECUCAO = 20;
/** Uma loja conferida não volta antes disto. */
const HORAS_ENTRE_CONFERENCIAS = 12;
/**
 * O tempo que o job se dá: parar antes do `maxDuration` é o que garante o
 * batimento anotado. A próxima execução continua de onde esta parou.
 */
const ORCAMENTO_MS = 40_000;

export async function GET(requisicao: NextRequest): Promise<NextResponse> {
  const autorizacao = autorizarJob(
    requisicao.headers.get(CABECALHO_DO_CRON),
    process.env.CRON_SECRET,
  );
  if (!autorizacao.ok) {
    log.aviso('job-avisos-shopify.recusado', { motivo: autorizacao.motivo });
    return NextResponse.json(
      { erro: 'nao_autorizado' },
      { status: autorizacao.status, headers: SEM_CACHE },
    );
  }

  if (!supabaseConfigurado || !serviceRoleConfigurada || !criptografiaConfigurada()) {
    return NextResponse.json(
      { erro: 'servidor_nao_configurado' },
      { status: 503, headers: SEM_CACHE },
    );
  }

  const inicio = Date.now();
  let conferidas = 0;
  let comFalta = 0;
  let recusadas = 0;
  let semResposta = 0;
  try {
    const servico = criarClientServiceRole();
    const limite = new Date(inicio - HORAS_ENTRE_CONFERENCIAS * 3_600_000).toISOString();
    const { data: lojas, error } = await servico
      .from('stores')
      .select('id')
      .not('shopify_scopes', 'is', null)
      .or(`shopify_avisos_conferidos_em.is.null,shopify_avisos_conferidos_em.lt.${limite}`)
      .order('shopify_avisos_conferidos_em', { ascending: true, nullsFirst: true })
      .limit(POR_EXECUCAO);
    if (error != null) throw new Error(error.message);

    for (const loja of lojas) {
      if (Date.now() - inicio > ORCAMENTO_MS) break;
      const conferencia = await conferirAvisosDaLoja(servico, loja.id);
      if (!conferencia.ok) {
        semResposta += 1;
        log.aviso('job-avisos-shopify.loja-nao-conferida', {
          loja: loja.id,
          motivo: conferencia.motivo,
        });
        continue;
      }
      conferidas += 1;
      if (conferencia.acessoRecusado) recusadas += 1;
      else if (conferencia.faltando.length > 0) comFalta += 1;
    }

    // Nenhuma respondeu: é a Shopify (ou a nossa rede), e a equipe precisa saber.
    if (semResposta > 0 && conferidas === 0) {
      throw new Error(`Nenhuma loja conferida: a Shopify não respondeu a ${String(semResposta)}.`);
    }

    await registrarBatimento('shopify-webhooks', inicio);
    return NextResponse.json(
      { ok: true, conferidas, comFalta, recusadas, semResposta },
      { headers: SEM_CACHE },
    );
  } catch (erro) {
    log.erro('job-avisos-shopify.falhou', { erro });
    await registrarBatimento('shopify-webhooks', inicio, erro);
    return NextResponse.json(
      { erro: 'indisponivel', conferidas, semResposta },
      { status: 500, headers: SEM_CACHE },
    );
  }
}

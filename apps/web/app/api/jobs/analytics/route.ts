/**
 * `GET /api/jobs/analytics` — recalcula os números do dia.
 *
 * O Vercel Cron chama de hora em hora, e não uma vez por dia à meia-noite. São
 * três razões, e as três aparecem na tela:
 *
 *   os clientes estão em fusos diferentes, e "meia-noite" daqui é meio-dia da
 *   loja de alguém;
 *   o dado chega atrasado — a Shopify reentrega webhook e o aparelho sem rede
 *   reporta depois;
 *   o lojista olha o painel durante o dia, e um número de ontem parado seria
 *   pior do que número nenhum.
 *
 * Chamar de hora em hora é seguro porque `consolidar_analytics` RECALCULA em
 * vez de acumular: duas execuções seguidas dão o mesmo resultado.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { CABECALHO_DO_CRON, autorizarJob, registrarBatimento } from '@/lib/jobs';
import { janelaDaConsolidacao } from '@/lib/analytics';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SEM_CACHE = { 'Cache-Control': 'no-store' } as const;

export async function GET(requisicao: NextRequest): Promise<NextResponse> {
  const autorizacao = autorizarJob(
    requisicao.headers.get(CABECALHO_DO_CRON),
    process.env.CRON_SECRET,
  );
  if (!autorizacao.ok) {
    log.aviso('job-numeros.recusado', { motivo: autorizacao.motivo });
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

  const dias = janelaDaConsolidacao(requisicao.nextUrl.searchParams.get('dias'));
  const inicio = Date.now();

  try {
    const supabase = criarClientServiceRole();
    const { data, error } = await supabase.rpc('consolidar_analytics', { p_dias: dias });

    if (error != null) {
      log.erro('job-numeros.consolidacao-falhou', { falha: error });
      await registrarBatimento('analytics', inicio, error.message);
      return NextResponse.json({ erro: 'indisponivel' }, { status: 500, headers: SEM_CACHE });
    }

    await registrarBatimento('analytics', inicio);
    return NextResponse.json({ ok: true, dias, escritas: data }, { headers: SEM_CACHE });
  } catch (erro) {
    log.erro('job-numeros.falhou', { erro });
    await registrarBatimento('analytics', inicio, erro);
    return NextResponse.json({ erro: 'indisponivel' }, { status: 500, headers: SEM_CACHE });
  }
}

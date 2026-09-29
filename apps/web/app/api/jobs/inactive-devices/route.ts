/**
 * `GET /api/jobs/inactive-devices` — agenda o "sentimos sua falta".
 *
 * De hora em hora, e não uma vez por dia: o "7º dia" começa à meia-noite de
 * cada loja, e as lojas estão em fusos diferentes. Rodar de novo é seguro —
 * `agendar_inativos` não agenda duas vezes para o mesmo sumiço — e a janela
 * de 7 a 9 dias cobre as horas em que o cron não rodou.
 *
 * Quem ENVIA é o despacho de cada minuto (`dispatch-push`), que também cancela
 * o aviso de quem voltou ao app antes do horário.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { CABECALHO_DO_CRON, autorizarJob, registrarBatimento } from '@/lib/jobs';
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
    log.aviso('job-inativos.recusado', { motivo: autorizacao.motivo });
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
  try {
    const { data, error } = await criarClientServiceRole().rpc('agendar_inativos');
    if (error != null) {
      log.erro('job-inativos.falhou', { falha: error });
      await registrarBatimento('inactive-devices', inicio, error.message);
      return NextResponse.json({ erro: 'indisponivel' }, { status: 500, headers: SEM_CACHE });
    }

    if (data > 0) log.info('job-inativos.agendados', { quantos: data });
    await registrarBatimento('inactive-devices', inicio);
    return NextResponse.json({ ok: true, agendados: data }, { headers: SEM_CACHE });
  } catch (erro) {
    log.erro('job-inativos.falhou', { erro });
    await registrarBatimento('inactive-devices', inicio, erro);
    return NextResponse.json({ erro: 'indisponivel' }, { status: 500, headers: SEM_CACHE });
  }
}

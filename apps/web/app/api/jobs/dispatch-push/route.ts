/**
 * `POST /api/jobs/dispatch-push` — o job que manda o push (seção 6 do plano).
 *
 * O Vercel Cron chama a cada minuto. Tudo que decide o que enviar está no
 * banco, em `reservar_campanhas` e `reservar_envios_de_automacao`: é lá que a
 * reserva é atômica, e é isso que impede duas execuções sobrepostas de
 * mandarem a mesma campanha duas vezes — um erro que não tem desfazer.
 *
 * Aqui só sobra: conferir quem chamou, abrir a chave da loja, falar com a
 * OneSignal e anotar o desfecho de cada um.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criptografiaConfigurada, descriptografar } from '@/lib/cripto';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import {
  CABECALHO_DO_CRON,
  RESUMO_VAZIO,
  autorizarJob,
  destinoDaFalha,
  faltaConfiguracao,
  type ResumoDoJob,
} from '@/lib/jobs';
import { enviarNotificacao } from '@/lib/onesignal';

export const dynamic = 'force-dynamic';
/** Uma leva de campanhas com muitas lojas pode passar de 10 segundos. */
export const maxDuration = 60;

/** O Vercel Cron usa GET; o POST fica para chamar à mão em uma investigação. */
export async function GET(requisicao: NextRequest): Promise<NextResponse> {
  return responder(requisicao);
}

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  return responder(requisicao);
}

async function responder(requisicao: NextRequest): Promise<NextResponse> {
  const autorizacao = autorizarJob(
    requisicao.headers.get(CABECALHO_DO_CRON),
    process.env.CRON_SECRET,
  );
  if (!autorizacao.ok) {
    console.warn('[dispatch-push] recusado:', autorizacao.motivo);
    return NextResponse.json(
      { erro: 'nao_autorizado' },
      { status: autorizacao.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!supabaseConfigurado || !serviceRoleConfigurada || !criptografiaConfigurada()) {
    console.error('[dispatch-push] servidor sem configuração para enviar push');
    return NextResponse.json(
      { erro: 'servidor_nao_configurado' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const resumo = { ...RESUMO_VAZIO };

  try {
    const supabase = criarClientServiceRole();

    /*
     * Antes de tudo, devolve à fila o que ficou preso por uma execução que
     * morreu no meio. Sem isto a campanha ficaria em "enviando" para sempre —
     * o estado de onde nada sai e ninguém repara.
     */
    const [{ data: campanhasPresas }, { data: enviosPresos }] = await Promise.all([
      supabase.rpc('devolver_campanhas_presas', { p_minutos: 15 }),
      supabase.rpc('devolver_envios_presos', { p_minutos: 15 }),
    ]);
    resumo.destravados = (campanhasPresas ?? 0) + (enviosPresos ?? 0);

    await despacharCampanhas(supabase, resumo);
    await despacharAutomacoes(supabase, resumo);
  } catch (erro) {
    console.error('[dispatch-push] falhou:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json(
      { erro: 'falhou', ...resumo },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  console.info('[dispatch-push]', resumo);
  return NextResponse.json(resumo, { headers: { 'Cache-Control': 'no-store' } });
}

type Client = ReturnType<typeof criarClientServiceRole>;

async function despacharCampanhas(supabase: Client, resumo: ResumoDoJob): Promise<void> {
  const { data: campanhas, error } = await supabase.rpc('reservar_campanhas', { p_limite: 20 });
  if (error != null) throw new Error(error.message);

  for (const campanha of campanhas) {
    resumo.processados += 1;

    const falta = faltaConfiguracao(campanha.onesignal_app_id, campanha.onesignal_api_key_enc);
    if (falta !== null || campanha.id === null) {
      await supabase.rpc('falhar_campanha', {
        p_id: campanha.id ?? '',
        p_motivo: falta ?? 'Campanha sem identificador.',
      });
      resumo.falhas += 1;
      continue;
    }

    let chave: string;
    try {
      chave = descriptografar(campanha.onesignal_api_key_enc ?? '');
    } catch {
      /*
       * A chave está no banco mas não abre com a ENCRYPTION_KEY atual. Isso é
       * configuração, não instabilidade: repetir a cada minuto só encheria o
       * log de uma falha que só uma pessoa resolve.
       */
      await supabase.rpc('falhar_campanha', {
        p_id: campanha.id,
        p_motivo: 'Não conseguimos ler a chave de envio desta loja.',
      });
      resumo.falhas += 1;
      continue;
    }

    const resultado = await enviarNotificacao(
      { appId: campanha.onesignal_app_id ?? '', chave },
      {
        title: campanha.title ?? '',
        body: campanha.body ?? '',
        deepLink: campanha.deep_link,
        segment: campanha.segment,
      },
    );

    if (resultado.ok) {
      await supabase.rpc('concluir_campanha', {
        p_id: campanha.id,
        p_notification_id: resultado.notificationId,
        // `enviados` já vem agora; entregues e aberturas chegam no job de
        // estatísticas, algumas horas depois.
        p_stats: resultado.destinatarios === null ? {} : { enviados: resultado.destinatarios },
      });
      resumo.enviados += 1;
      continue;
    }

    if (destinoDaFalha(resultado.permanente) === 'falhar') {
      await supabase.rpc('falhar_campanha', { p_id: campanha.id, p_motivo: resultado.motivo });
      resumo.falhas += 1;
    }
    /*
     * Falha passageira: não marca nada. `devolver_campanhas_presas` recoloca a
     * campanha na fila em 15 minutos, e o minuto seguinte tenta de novo.
     */
  }
}

async function despacharAutomacoes(supabase: Client, resumo: ResumoDoJob): Promise<void> {
  const { data: envios, error } = await supabase.rpc('reservar_envios_de_automacao', {
    p_limite: 100,
  });
  if (error != null) throw new Error(error.message);

  for (const envio of envios) {
    resumo.processados += 1;
    if (envio.id === null) continue;

    const falta = faltaConfiguracao(envio.onesignal_app_id, envio.onesignal_api_key_enc);
    if (falta !== null) {
      await supabase.rpc('falhar_envio', { p_id: envio.id, p_motivo: falta });
      resumo.falhas += 1;
      continue;
    }

    let chave: string;
    try {
      chave = descriptografar(envio.onesignal_api_key_enc ?? '');
    } catch {
      await supabase.rpc('falhar_envio', {
        p_id: envio.id,
        p_motivo: 'Não conseguimos ler a chave de envio desta loja.',
      });
      resumo.falhas += 1;
      continue;
    }

    const resultado = await enviarNotificacao(
      { appId: envio.onesignal_app_id ?? '', chave },
      {
        title: envio.title ?? '',
        body: envio.body ?? '',
        deepLink: envio.deep_link,
        // Automação é para UM aparelho: o que disparou o gatilho.
        inscricoes: envio.subscription_id === null ? [] : [envio.subscription_id],
      },
    );

    if (resultado.ok) {
      await supabase.rpc('concluir_envio', { p_id: envio.id });
      resumo.enviados += 1;
      continue;
    }

    if (destinoDaFalha(resultado.permanente) === 'falhar') {
      await supabase.rpc('falhar_envio', { p_id: envio.id, p_motivo: resultado.motivo });
      resumo.falhas += 1;
    }
  }
}

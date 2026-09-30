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
  registrarBatimento,
  faltaConfiguracao,
  type ResumoDoJob,
} from '@/lib/jobs';
import { enviarNotificacao } from '@/lib/onesignal';
import { urlDaImagemDoPush } from '@/lib/imagem-do-push';
import { log } from '@/lib/log';

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
    log.aviso('job-despacho.recusado', { motivo: autorizacao.motivo });
    return NextResponse.json(
      { erro: 'nao_autorizado' },
      { status: autorizacao.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!supabaseConfigurado || !serviceRoleConfigurada || !criptografiaConfigurada()) {
    log.erro('job-despacho.sem-configuracao');
    return NextResponse.json(
      { erro: 'servidor_nao_configurado' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const resumo = { ...RESUMO_VAZIO };
  const inicio = Date.now();

  try {
    const supabase = criarClientServiceRole();

    /*
     * Antes de tudo, devolve à fila o que ficou preso por uma execução que
     * morreu no meio. Sem isto a campanha ficaria em "enviando" para sempre —
     * o estado de onde nada sai e ninguém repara.
     */
    const [campanhasPresas, enviosPresos] = await Promise.all([
      supabase.rpc('devolver_campanhas_presas', { p_minutos: 15 }),
      supabase.rpc('devolver_envios_presos', { p_minutos: 15 }),
    ]);
    /*
     * Falhar ao destravar NÃO para o despacho: o que está na fila sai do mesmo
     * jeito, e o preso volta na próxima volta. Mas a falha vai para o log — em
     * silêncio, a campanha ficaria "enviando" para sempre sem ninguém saber.
     */
    for (const [qual, lida] of [
      ['campanhas', campanhasPresas],
      ['envios', enviosPresos],
    ] as const) {
      if (lida.error != null)
        log.erro('job-despacho.destravar-falhou', { qual, falha: lida.error });
    }
    resumo.destravados = (campanhasPresas.data ?? 0) + (enviosPresos.data ?? 0);

    await despacharCampanhas(supabase, resumo);
    await despacharAutomacoes(supabase, resumo);
    // O que saiu e não foi anotado precisa aparecer no batimento, e não só no log.
    if (resumo.naoAnotados > 0) {
      throw new Error(`${String(resumo.naoAnotados)} desfecho(s) não foram anotados no banco.`);
    }
  } catch (erro) {
    log.erro('job-despacho.falhou', { erro });
    await registrarBatimento('dispatch-push', inicio, erro);
    return NextResponse.json(
      { erro: 'falhou', ...resumo },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  log.info('job-despacho.concluido', { ...resumo });
  await registrarBatimento('dispatch-push', inicio);
  return NextResponse.json(resumo, { headers: { 'Cache-Control': 'no-store' } });
}

type Client = ReturnType<typeof criarClientServiceRole>;

/**
 * Anota o desfecho de um envio. A falha não interrompe a leva — os outros
 * envios seguem —, mas vai para o log e para o resumo, e o job termina
 * acusando-a no batimento. A notificação que saiu e não foi anotada volta
 * para a fila em 15 minutos; a chave de idempotência faz a OneSignal
 * devolver a de antes em vez de mandar de novo.
 */
async function anotar(
  resumo: ResumoDoJob,
  oQue: string,
  chamada: PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  const { error } = await chamada;
  if (error == null) return;
  resumo.naoAnotados += 1;
  log.erro('job-despacho.desfecho-nao-anotado', { oQue, falha: error.message });
}

async function despacharCampanhas(supabase: Client, resumo: ResumoDoJob): Promise<void> {
  const { data: campanhas, error } = await supabase.rpc('reservar_campanhas', { p_limite: 20 });
  if (error != null) throw new Error(error.message);

  for (const campanha of campanhas) {
    resumo.processados += 1;

    const falta = faltaConfiguracao(campanha.onesignal_app_id, campanha.onesignal_api_key_enc);
    if (falta !== null || campanha.id === null) {
      await anotar(
        resumo,
        'falhar_campanha',
        supabase.rpc('falhar_campanha', {
          p_id: campanha.id ?? '',
          p_motivo: falta ?? 'Campanha sem identificador.',
        }),
      );
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
      await anotar(
        resumo,
        'falhar_campanha',
        supabase.rpc('falhar_campanha', {
          p_id: campanha.id,
          p_motivo: 'Não conseguimos ler a chave de envio desta loja.',
        }),
      );
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
        imagem:
          campanha.image_path === null ? null : urlDaImagemDoPush(supabase, campanha.image_path),
        origem: { tipo: 'campanha', id: campanha.id },
        idempotencia: campanha.id,
      },
    );

    if (resultado.ok) {
      await anotar(
        resumo,
        'concluir_campanha',
        supabase.rpc('concluir_campanha', {
          p_id: campanha.id,
          p_notification_id: resultado.notificationId,
          // `enviados` já vem agora; entregues e aberturas chegam no job de
          // estatísticas, algumas horas depois.
          p_stats: resultado.destinatarios === null ? {} : { enviados: resultado.destinatarios },
        }),
      );
      resumo.enviados += 1;
      continue;
    }

    if (destinoDaFalha(resultado.permanente) === 'falhar') {
      await anotar(
        resumo,
        'falhar_campanha',
        supabase.rpc('falhar_campanha', { p_id: campanha.id, p_motivo: resultado.motivo }),
      );
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
      await anotar(
        resumo,
        'falhar_envio',
        supabase.rpc('falhar_envio', { p_id: envio.id, p_motivo: falta }),
      );
      resumo.falhas += 1;
      continue;
    }

    let chave: string;
    try {
      chave = descriptografar(envio.onesignal_api_key_enc ?? '');
    } catch {
      await anotar(
        resumo,
        'falhar_envio',
        supabase.rpc('falhar_envio', {
          p_id: envio.id,
          p_motivo: 'Não conseguimos ler a chave de envio desta loja.',
        }),
      );
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
        ...(envio.automation_id === null
          ? {}
          : { origem: { tipo: 'automacao', id: envio.automation_id } as const }),
        // O id do envio volta no toque: é por ele que a automação conta as aberturas.
        envio: envio.id,
        idempotencia: envio.id,
      },
    );

    if (resultado.ok) {
      await anotar(resumo, 'concluir_envio', supabase.rpc('concluir_envio', { p_id: envio.id }));
      resumo.enviados += 1;
      continue;
    }

    if (destinoDaFalha(resultado.permanente) === 'falhar') {
      await anotar(
        resumo,
        'falhar_envio',
        supabase.rpc('falhar_envio', { p_id: envio.id, p_motivo: resultado.motivo }),
      );
      resumo.falhas += 1;
    }
  }
}

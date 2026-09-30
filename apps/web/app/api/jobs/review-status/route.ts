/**
 * `GET /api/jobs/review-status` — em que pé está cada app nas duas lojas.
 *
 * O Vercel Cron chama de hora em hora. Nem a Apple nem o Google avisam por
 * webhook: a única forma de saber é perguntar, e as revisões levam de horas a
 * dias — perguntar mais rápido só gastaria a cota da chave do lojista.
 *
 * O que a loja diz vira `builds.store_state` a cada consulta, mesmo quando não
 * há decisão nenhuma: é o estado que conta ao lojista se falta um passo DELE —
 * enviar para a revisão na App Store Connect, promover para a produção no
 * Play Console — e que antes era jogado fora.
 *
 * No Android, a versão vai para o teste interno, que a Google não revisa. Ela
 * passa a "em revisão" quando o lojista a manda para a produção, e a
 * "aprovada" quando o app está aberto na Play Store (`lib/google-play.ts`).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criptografiaConfigurada, descriptografar } from '@/lib/cripto';
import { serviceRoleConfigurada, supabaseConfigurado, urlDoSite } from '@/lib/env';
import { CABECALHO_DO_CRON, autorizarJob, registrarBatimento } from '@/lib/jobs';
import {
  consultarRevisao,
  estadoGravavel,
  mensagemDaRevisao,
  type StatusDaRevisao,
} from '@/lib/revisao';
import { consultarPlay } from '@/lib/google-play';
import { enviarEmail } from '@/lib/email';
import { mereceAviso, montarAviso } from '@/lib/aviso-da-revisao';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SEM_CACHE = { 'Cache-Control': 'no-store' } as const;

/** Quantos builds um ciclo olha. Mais do que isso estoura o minuto da Vercel. */
const LIMITE = 40;

export async function GET(requisicao: NextRequest): Promise<NextResponse> {
  const autorizacao = autorizarJob(
    requisicao.headers.get(CABECALHO_DO_CRON),
    process.env.CRON_SECRET,
  );
  if (!autorizacao.ok) {
    log.aviso('job-revisao.recusado', { motivo: autorizacao.motivo });
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

  let consultados = 0;
  let mudados = 0;
  let avisados = 0;
  /** Builds cuja revisão não pôde ser gravada: o batimento conta como falha. */
  let naoGravados = 0;
  const inicio = Date.now();

  try {
    const supabase = criarClientServiceRole();

    const { data: builds, error } = await supabase.rpc('builds_em_revisao', { p_limite: LIMITE });
    if (error != null) throw new Error(error.message);

    for (const build of builds) {
      if (build.id === null) continue;

      const consulta = await consultarBuild(build);
      // Sem chave completa, ou com a chave que não abre: não há o que perguntar.
      if (consulta === null) continue;
      consultados += 1;

      if (!consulta.ok) {
        // Falha passageira: a próxima hora tenta de novo, sem mexer no build.
        if (consulta.passageiro) {
          log.aviso('job-revisao.consulta-passageira', {
            build: build.id,
            motivo: consulta.motivo,
          });
          continue;
        }

        /*
         * Sem `p_status`: o build fica onde está e só a mensagem aparece. Uma
         * chave revogada não é uma decisão da loja sobre o app, e mover o
         * status por causa dela mentiria sobre a revisão.
         */
        const { error: erroAoGravar } = await supabase.rpc('gravar_revisao', {
          p_id: build.id,
          p_erro: consulta.motivo,
        });
        if (erroAoGravar != null) {
          log.erro('job-revisao.gravacao-falhou', { build: build.id, falha: erroAoGravar });
          naoGravados += 1;
          continue;
        }
        mudados += 1;
        continue;
      }

      const { data: mudou, error: erroAoGravar } = await supabase.rpc('gravar_revisao', {
        p_id: build.id,
        p_status: consulta.status ?? undefined,
        /*
         * Sem mensagem, o campo é limpo: um "aprovado" não pode carregar o
         * texto de uma recusa anterior, nem uma consulta que voltou a dar
         * certo o aviso da chave que não abria.
         */
        p_erro: consulta.motivo ?? undefined,
        p_estado: consulta.estado ?? undefined,
      });
      if (erroAoGravar != null) {
        log.erro('job-revisao.gravacao-falhou', { build: build.id, falha: erroAoGravar });
        naoGravados += 1;
        continue;
      }
      if (!mudou) continue;

      mudados += 1;

      /*
       * O aviso vem depois da gravação, nunca antes: se a ordem fosse ao
       * contrário, uma queda entre os dois mandaria ao lojista um "seu app foi
       * aprovado" sobre um build que continua marcado como em revisão na tela
       * dele. A reserva do aviso garante um e-mail só por build, mesmo quando
       * o que mudou foi só o estado ("aprovado" → "na loja").
       */
      if (consulta.status !== null && mereceAviso(consulta.status)) {
        if (await avisar(supabase, build.id, consulta.status, consulta.motivo)) avisados += 1;
      }
    }
  } catch (erro) {
    log.erro('job-revisao.falhou', { erro });
    await registrarBatimento('review-status', inicio, erro);
    return NextResponse.json(
      { erro: 'falhou', consultados, mudados },
      { status: 500, headers: SEM_CACHE },
    );
  }

  log.info('job-revisao.concluido', { consultados, mudados, avisados, naoGravados });
  // Um build que não gravou é revisão que o lojista não vai ver: o batimento
  // diz, e a página de status mostra "instável" em vez de "funcionando".
  await registrarBatimento(
    'review-status',
    inicio,
    naoGravados > 0 ? `${String(naoGravados)} revisão(ões) não gravada(s)` : undefined,
  );
  return NextResponse.json({ consultados, mudados, avisados, naoGravados }, { headers: SEM_CACHE });
}

type LinhaDaRevisao = Database['public']['Functions']['builds_em_revisao']['Returns'][number];

type ConsultaDoBuild =
  | { ok: true; status: StatusDaRevisao | null; estado: string | null; motivo: string | null }
  | { ok: false; passageiro: boolean; motivo: string };

/**
 * Pergunta à loja certa em que pé está o build. `null` quando não há como
 * perguntar: a conta sem as chaves completas, ou a chave que não abre.
 */
async function consultarBuild(build: LinhaDaRevisao): Promise<ConsultaDoBuild | null> {
  if (build.id === null) return null;

  if (build.platform === 'ios') {
    const { bundle_id_ios: bundle, asc_key_enc: cifrada } = build;
    const { asc_key_id: keyId, asc_issuer_id: issuerId } = build;
    if (bundle === null || cifrada === null || keyId === null || issuerId === null) return null;
    const p8 = abrirChave(build.id, cifrada);
    if (p8 === null) return null;

    const consulta = await consultarRevisao({ p8, keyId, issuerId }, bundle, build.version);
    if (!consulta.ok) return consulta;
    return {
      ok: true,
      status: consulta.status,
      estado: estadoGravavel(consulta.estado),
      motivo: consulta.status === null ? null : mensagemDaRevisao(consulta.status, consulta.estado),
    };
  }

  if (build.platform === 'android') {
    const { package_android: pacote, google_service_account_enc: cifrada } = build;
    if (pacote === null || cifrada === null || build.build_number === null) return null;
    const conta = abrirChave(build.id, cifrada);
    if (conta === null) return null;

    const consulta = await consultarPlay(conta, pacote, build.build_number);
    if (!consulta.ok) return consulta;
    return { ok: true, status: consulta.status, estado: consulta.estado, motivo: null };
  }

  return null;
}

/**
 * Abre a chave cifrada da conta do lojista.
 *
 * A chave de uma loja não abrir não pode parar as outras. Ela vai aparecer
 * como falha no próximo build, com o motivo — aqui, gravar erro seria
 * transformar um problema nosso de criptografia numa mensagem que o lojista
 * não consegue agir. Mas a equipe precisa saber: é problema NOSSO.
 */
function abrirChave(buildId: string, cifrada: string): string | null {
  try {
    return descriptografar(cifrada);
  } catch (erro) {
    log.erro('job-revisao.chave-nao-abre', { build: buildId, erro });
    return null;
  }
}

/**
 * Manda o e-mail da decisão, uma vez só.
 *
 * A reserva é atômica e vem ANTES do envio: o cron roda de hora em hora, e uma
 * execução que demore mais do que isso encontra a seguinte já rodando. Sem a
 * reserva, as duas mandariam o mesmo "seu app foi aprovado".
 *
 * Quando o envio falha por algo que melhora sozinho, a reserva é devolvida —
 * senão uma queda de dez minutos do serviço de e-mail faria o lojista nunca
 * saber que o app foi aprovado.
 */
async function avisar(
  supabase: SupabaseClient<Database>,
  buildId: string,
  decisao: 'approved' | 'rejected',
  motivo: string | null,
): Promise<boolean> {
  const { data: reservado, error: erroDaReserva } = await supabase.rpc('reservar_aviso', {
    p_id: buildId,
    p_status: decisao,
  });
  if (erroDaReserva != null) {
    log.erro('job-revisao.reserva-falhou', { build: buildId, falha: erroDaReserva });
    return false;
  }
  if (!reservado) return false;

  const { data: destinos, error: erroDosDestinos } = await supabase.rpc('emails_do_build', {
    p_id: buildId,
  });
  if (erroDosDestinos != null) {
    // Sem saber para quem, a reserva volta: "ninguém para avisar" seria mentira.
    log.erro('job-revisao.destinos-falharam', { build: buildId, falha: erroDosDestinos });
    await devolverAviso(supabase, buildId);
    return false;
  }
  const para = destinos
    .map((linha) => linha.email)
    .filter((email): email is string => email !== null && email !== '');

  if (para.length === 0) {
    // Ninguém para avisar não é falha: a reserva fica de pé para o aviso não
    // voltar a ser tentado a cada hora para uma organização sem e-mail ativo.
    return false;
  }

  const { data: plataforma, error: erroDaPlataforma } = await supabase
    .from('builds')
    .select('platform')
    .eq('id', buildId)
    .maybeSingle();
  if (erroDaPlataforma != null) {
    // O e-mail diria a loja errada ("App Store" para um build do Android).
    log.erro('job-revisao.plataforma-falhou', { build: buildId, falha: erroDaPlataforma });
    await devolverAviso(supabase, buildId);
    return false;
  }

  const mensagem = montarAviso({
    decisao,
    nomeDaLoja: destinos[0]?.nome_da_loja ?? '',
    plataforma: plataforma?.platform ?? 'ios',
    motivo,
    url: `${urlDoSite()}/publicacao`,
  });

  const envio = await enviarEmail({ ...mensagem, para });
  if (envio.ok) return true;

  log.aviso('job-revisao.aviso-nao-saiu', { motivo: envio.motivo });
  if (envio.passageiro) await supabase.rpc('devolver_aviso', { p_id: buildId });
  return false;
}

/**
 * Devolve a reserva do aviso para a próxima rodada. Se nem isso gravar, o
 * aviso fica reservado sem sair — e só o log conta que alguém não foi avisado.
 */
async function devolverAviso(
  supabase: ReturnType<typeof criarClientServiceRole>,
  buildId: string,
): Promise<void> {
  const { error } = await supabase.rpc('devolver_aviso', { p_id: buildId });
  if (error != null) log.erro('job-revisao.aviso-nao-devolvido', { build: buildId, falha: error });
}

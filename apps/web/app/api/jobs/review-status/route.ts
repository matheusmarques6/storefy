/**
 * `GET /api/jobs/review-status` — em que pé está a revisão da Apple.
 *
 * O Vercel Cron chama de hora em hora. Não existe webhook para a revisão da
 * App Store: a única forma de saber é perguntar, e a revisão leva de um a três
 * dias — perguntar mais rápido só gastaria cota da chave do lojista sem mudar
 * nada na tela.
 *
 * Só builds de iOS entram. O envio ao Google vai para a trilha interna, que
 * não passa por revisão: ali `submitted` já é o estado final até o lojista
 * promover a versão no Play Console, e inventar um `approved` diria a ele que
 * o app está no ar quando não está.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criptografiaConfigurada, descriptografar } from '@/lib/cripto';
import { serviceRoleConfigurada, supabaseConfigurado, urlDoSite } from '@/lib/env';
import { CABECALHO_DO_CRON, autorizarJob } from '@/lib/jobs';
import { consultarRevisao, mensagemDaRevisao } from '@/lib/revisao';
import { enviarEmail } from '@/lib/email';
import { mereceAviso, montarAviso } from '@/lib/aviso-da-revisao';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';

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
    console.warn('[review-status] recusado:', autorizacao.motivo);
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

  try {
    const supabase = criarClientServiceRole();

    const { data: builds, error } = await supabase.rpc('builds_em_revisao', { p_limite: LIMITE });
    if (error != null) throw new Error(error.message);

    for (const build of builds) {
      if (build.id === null || build.bundle_id_ios === null || build.asc_key_enc === null) continue;
      if (build.asc_key_id === null || build.asc_issuer_id === null) continue;

      consultados += 1;

      let p8: string;
      try {
        p8 = descriptografar(build.asc_key_enc);
      } catch {
        /*
         * A chave de uma loja não abrir não pode parar as outras. Ela vai
         * aparecer como falha no próximo build, com o motivo — aqui, gravar
         * erro seria transformar um problema nosso de criptografia numa
         * mensagem que o lojista não consegue agir.
         */
        continue;
      }

      const consulta = await consultarRevisao(
        { p8, keyId: build.asc_key_id, issuerId: build.asc_issuer_id },
        build.bundle_id_ios,
      );

      if (!consulta.ok) {
        // Falha passageira: a próxima hora tenta de novo, em silêncio.
        if (consulta.passageiro) continue;

        /*
         * Sem `p_status`: o build fica onde está e só a mensagem aparece. Uma
         * chave revogada não é uma decisão da Apple sobre o app, e mover o
         * status por causa dela mentiria sobre a revisão.
         */
        await supabase.rpc('gravar_revisao', { p_id: build.id, p_erro: consulta.motivo });
        mudados += 1;
        continue;
      }

      // Estado que não vira nada nosso: a linha fica como está, de propósito.
      if (consulta.status === null) continue;

      const motivo = mensagemDaRevisao(consulta.status, consulta.estado);
      const { data: mudou } = await supabase.rpc('gravar_revisao', {
        p_id: build.id,
        p_status: consulta.status,
        // Sem mensagem, o campo é limpo: um "aprovado" não pode carregar o
        // texto de uma recusa anterior.
        p_erro: motivo ?? undefined,
      });
      if (mudou !== true) continue;

      mudados += 1;

      /*
       * O aviso vem depois da gravação, nunca antes: se a ordem fosse ao
       * contrário, uma queda entre os dois mandaria ao lojista um "seu app foi
       * aprovado" sobre um build que continua marcado como em revisão na tela
       * dele.
       */
      if (mereceAviso(consulta.status)) {
        if (await avisar(supabase, build.id, consulta.status, motivo)) avisados += 1;
      }
    }
  } catch (erro) {
    console.error('[review-status] falhou:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json(
      { erro: 'falhou', consultados, mudados },
      { status: 500, headers: SEM_CACHE },
    );
  }

  console.info('[review-status]', { consultados, mudados, avisados });
  return NextResponse.json({ consultados, mudados, avisados }, { headers: SEM_CACHE });
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
  const { data: reservado } = await supabase.rpc('reservar_aviso', {
    p_id: buildId,
    p_status: decisao,
  });
  if (reservado !== true) return false;

  const { data: destinos } = await supabase.rpc('emails_do_build', { p_id: buildId });
  const para = (destinos ?? [])
    .map((linha) => linha.email)
    .filter((email): email is string => email !== null && email !== '');

  if (para.length === 0) {
    // Ninguém para avisar não é falha: a reserva fica de pé para o aviso não
    // voltar a ser tentado a cada hora para uma organização sem e-mail ativo.
    return false;
  }

  const { data: plataforma } = await supabase
    .from('builds')
    .select('platform')
    .eq('id', buildId)
    .maybeSingle();

  const mensagem = montarAviso({
    decisao,
    nomeDaLoja: destinos?.[0]?.nome_da_loja ?? '',
    plataforma: plataforma?.platform ?? 'ios',
    motivo,
    url: `${urlDoSite()}/publicacao`,
  });

  const envio = await enviarEmail({ ...mensagem, para });
  if (envio.ok) return true;

  console.warn('[review-status] aviso não saiu:', envio.motivo);
  if (envio.passageiro) await supabase.rpc('devolver_aviso', { p_id: buildId });
  return false;
}

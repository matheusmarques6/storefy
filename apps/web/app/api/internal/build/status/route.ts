/**
 * `POST /api/internal/build/status` — o workflow conta como foi.
 *
 * Mesma autenticação da rota irmã, mas esta NÃO devolve nada sensível: ela só
 * recebe. Fica separada porque as duas têm riscos diferentes — um vazamento do
 * segredo aqui permitiria mentir sobre o status de um build, o que é ruim; na
 * outra, permitiria baixar a chave de publicação de um cliente, o que é grave.
 * Separadas, dá para trocar só uma se precisar.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { CABECALHO_DO_SEGREDO, autorizarWorkflow, origensPermitidas } from '@/lib/build-interno';
import { interpretarFalhaDoEnvio } from '@/lib/submissao';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' } as const;

/**
 * O que o workflow pode dizer.
 *
 * Só os status que o RUNNER conhece. `submitted`, `in_review` e `approved`
 * vêm de outros lugares (o submit e o cron da App Store Connect), e aceitá-los
 * aqui deixaria um workflow com bug marcar como aprovado um app que a Apple
 * nunca viu.
 */
const Corpo = z.object({
  buildId: z.uuid(),
  status: z.enum(['building', 'finished', 'errored', 'submitted']),
  easBuildId: z.string().trim().min(1).max(200).optional(),
  logsUrl: z.url().optional(),
  version: z.string().trim().min(1).max(40).optional(),
  buildNumber: z.int().min(1).optional(),
  /** Mensagem para o lojista quando falhou. */
  erro: z.string().trim().min(1).max(2000).optional(),
  /** Id da submissão no EAS, quando o envio começou. */
  submissionId: z.string().trim().min(1).max(200).optional(),
  /**
   * O passo manual que destrava este build.
   *
   * Lista fechada: a tela escolhe o passo a passo a partir DESTE valor, e não
   * lendo palavra dentro da mensagem de erro — que é texto do EAS e muda sem
   * aviso.
   */
  manualAction: z.enum(['play_primeiro_envio', 'envio_manual']).optional(),
  /**
   * Qual etapa está falando, quando a distinção muda o que fazemos.
   *
   * Só o ENVIO precisa dizer: uma falha dele vem como texto cru do `eas submit`
   * e é traduzida aqui, com a plataforma, porque a mesma mensagem significa
   * coisas diferentes na Apple e no Google.
   */
  etapa: z.enum(['build', 'submit']).optional(),
  plataforma: z.enum(['ios', 'android']).optional(),
  /**
   * A saída crua do `eas submit`.
   *
   * Vem crua e é traduzida AQUI, e não no shell do workflow: a decisão de qual
   * passo manual mostrar tem teste, e um `grep` dentro de um YAML não tem.
   */
  erroBruto: z.string().max(4000).optional(),
  /**
   * O projeto Expo desta loja, quando o workflow acabou de criá-lo.
   *
   * `eas init` só roda na primeira publicação de uma loja, e o id que ele
   * devolve precisa voltar para `apps.expo_project_id` — senão a publicação
   * seguinte cria OUTRO projeto, e a loja passa a ter dois apps no Expo
   * disputando o mesmo bundle, cada um com metade do histórico de builds.
   */
  expoProjectId: z.uuid().optional(),
});

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const autorizacao = autorizarWorkflow(
    requisicao.headers.get(CABECALHO_DO_SEGREDO),
    process.env.BUILD_API_SECRET,
  );
  if (!autorizacao.ok) {
    console.warn('[build-status] recusado:', autorizacao.motivo);
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

  const analise = Corpo.safeParse(await requisicao.json().catch(() => null));
  if (!analise.success) {
    return NextResponse.json({ erro: 'corpo_invalido' }, { status: 400, headers: SEM_CACHE });
  }

  const {
    buildId,
    status,
    easBuildId,
    logsUrl,
    version,
    buildNumber,
    erro,
    submissionId,
    manualAction,
    etapa,
    plataforma,
    erroBruto,
    expoProjectId,
  } = analise.data;
  const agora = new Date().toISOString();

  /*
   * A falha do envio chega crua e é traduzida aqui, com a plataforma: a mesma
   * frase do `eas submit` significa coisas diferentes na Apple e no Google, e o
   * caso que mais importa — o primeiro envio ao Play, que o Google exige que
   * seja manual — precisa virar um passo a passo na tela, não um erro seco.
   */
  const falha =
    etapa === 'submit' && status === 'errored'
      ? interpretarFalhaDoEnvio(plataforma ?? 'android', erroBruto ?? '')
      : null;

  try {
    const servico = criarClientServiceRole();

    const { data: linhas, error } = await servico
      .from('builds')
      .update({
        status,
        eas_build_id: easBuildId,
        logs_url: logsUrl,
        version,
        build_number: buildNumber,
        error: falha?.mensagem ?? erro,
        submission_id: submissionId,
        manual_action: falha?.acaoManual ?? manualAction,
        finished_at: status === 'finished' || status === 'errored' ? agora : undefined,
        submitted_at: status === 'submitted' ? agora : undefined,
      })
      .eq('id', buildId)
      /*
       * A trava é POR AVISO, e não uma lista larga: sem ela, uma execução
       * repetida do workflow — que o GitHub faz sozinho em "re-run" —
       * reescreveria um build já aprovado como "gerando", e o workflow de envio
       * poderia marcar "enviado" um build que nunca gerou nada.
       */
      .in('status', origensPermitidas(status))
      .select('app_id');

    if (error != null) {
      console.error('[build-status] falhou:', error.message);
      return NextResponse.json({ erro: 'indisponivel' }, { status: 503, headers: SEM_CACHE });
    }

    /*
     * O projeto Expo recém-criado volta para `apps`, e não para `builds`: ele é
     * da LOJA, não desta publicação. Gravá-lo no build faria a publicação
     * seguinte não achá-lo e criar um segundo projeto no Expo.
     */
    const appId = linhas[0]?.app_id;
    if (expoProjectId != null && appId != null) {
      await servico
        .from('apps')
        .update({ expo_project_id: expoProjectId })
        .eq('id', appId)
        // Só preenche o que está vazio: o id de um projeto que já existe não
        // muda, e sobrescrevê-lo órfãozaria todo o histórico de builds da loja.
        .is('expo_project_id', null);
    }
  } catch (erroDoBanco) {
    console.error(
      '[build-status] falhou:',
      erroDoBanco instanceof Error ? erroDoBanco.message : 'desconhecido',
    );
    return NextResponse.json({ erro: 'indisponivel' }, { status: 503, headers: SEM_CACHE });
  }

  return NextResponse.json({ ok: true }, { headers: SEM_CACHE });
}

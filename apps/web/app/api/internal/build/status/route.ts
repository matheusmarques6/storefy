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
import { CABECALHO_DO_SEGREDO, autorizarWorkflow } from '@/lib/build-interno';

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

  const { buildId, status, easBuildId, logsUrl, version, buildNumber, erro } = analise.data;
  const agora = new Date().toISOString();

  try {
    const servico = criarClientServiceRole();

    const { error } = await servico
      .from('builds')
      .update({
        status,
        eas_build_id: easBuildId,
        logs_url: logsUrl,
        version,
        build_number: buildNumber,
        error: erro,
        finished_at: status === 'finished' || status === 'errored' ? agora : undefined,
        submitted_at: status === 'submitted' ? agora : undefined,
      })
      .eq('id', buildId)
      /*
       * Só avança a partir de "na fila" ou "gerando". Sem isto, uma execução
       * repetida do workflow — que o GitHub faz sozinho em "re-run" —
       * reescreveria um build já aprovado como "gerando".
       */
      .in('status', ['queued', 'building']);

    if (error != null) {
      console.error('[build-status] falhou:', error.message);
      return NextResponse.json({ erro: 'indisponivel' }, { status: 503, headers: SEM_CACHE });
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

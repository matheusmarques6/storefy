/**
 * `POST /api/internal/ota/status` — cada loja da matriz conta como foi.
 *
 * Separada da rota irmã pelo mesmo motivo do build: esta só RECEBE. Um
 * vazamento do segredo aqui permitiria mentir sobre o andamento de uma
 * correção; na outra, permitiria baixar o segredo do app de um cliente.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { CABECALHO_DO_SEGREDO, autorizarWorkflow } from '@/lib/build-interno';
import { terminou } from '@/lib/ota';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' } as const;

const Corpo = z.object({
  otaId: z.uuid(),
  /** Uma loja terminou: deu certo ou não. */
  ok: z.boolean().optional(),
  /** A rodada inteira falhou antes de montar a matriz. */
  erro: z.string().trim().min(1).max(2000).optional(),
  commitSha: z.string().trim().min(7).max(64).optional(),
});

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const autorizacao = autorizarWorkflow(
    requisicao.headers.get(CABECALHO_DO_SEGREDO),
    process.env.BUILD_API_SECRET,
  );
  if (!autorizacao.ok) {
    console.warn('[ota-status] recusado:', autorizacao.motivo);
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

  const { otaId, ok, erro, commitSha } = analise.data;

  try {
    const servico = criarClientServiceRole();

    if (ok !== undefined) {
      /*
       * Soma no banco, não aqui: os jobs da matriz correm em paralelo, e dois
       * terminando ao mesmo tempo escreveriam por cima um do outro se o
       * contador fosse lido e gravado em duas idas.
       */
      const { error } = await servico.rpc('contar_ota', { p_id: otaId, p_ok: ok });
      if (error != null) throw new Error(error.message);
    }

    const { data: rodada, error: erroDaLeitura } = await servico
      .from('ota_updates')
      .select('total, concluidas, falhas, status')
      .eq('id', otaId)
      .maybeSingle();
    if (erroDaLeitura != null) throw new Error(erroDaLeitura.message);
    if (rodada == null) {
      return NextResponse.json(
        { erro: 'rodada_nao_encontrada' },
        { status: 404, headers: SEM_CACHE },
      );
    }

    const fim = erro !== undefined || terminou(rodada);
    if (fim) {
      await servico
        .from('ota_updates')
        .update({
          status: erro !== undefined || rodada.falhas > 0 ? 'errored' : 'finished',
          error: erro,
          commit_sha: commitSha,
          finished_at: new Date().toISOString(),
        })
        .eq('id', otaId)
        .in('status', ['queued', 'running']);
    } else if (commitSha !== undefined) {
      await servico.from('ota_updates').update({ commit_sha: commitSha }).eq('id', otaId);
    }
  } catch (erroDoBanco) {
    console.error(
      '[ota-status] falhou:',
      erroDoBanco instanceof Error ? erroDoBanco.message : 'desconhecido',
    );
    return NextResponse.json({ erro: 'indisponivel' }, { status: 503, headers: SEM_CACHE });
  }

  return NextResponse.json({ ok: true }, { headers: SEM_CACHE });
}

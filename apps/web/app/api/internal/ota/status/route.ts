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
import type { Database } from '@storefy/db';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' } as const;

const Corpo = z.object({
  otaId: z.uuid(),
  /** Uma loja terminou: deu certo ou não. */
  ok: z.boolean().optional(),
  /**
   * Qual loja. Com ela, a mesma loja contada de novo (o workflow tentou outra
   * vez) não soma, e a que falhou e deu certo depois passa a concluída.
   */
  storeId: z.uuid().optional(),
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
    log.aviso('ota-status.recusado', { motivo: autorizacao.motivo });
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

  const { otaId, ok, storeId, erro, commitSha } = analise.data;

  try {
    const servico = criarClientServiceRole();

    if (ok !== undefined) {
      /*
       * Soma no banco, não aqui: os jobs da matriz correm em paralelo, e dois
       * terminando ao mesmo tempo escreveriam por cima um do outro se o
       * contador fosse lido e gravado em duas idas.
       */
      const { error } = await servico.rpc('contar_ota', {
        p_id: otaId,
        p_ok: ok,
        ...(storeId === undefined ? {} : { p_store_id: storeId }),
      });
      if (error != null) throw new Error(error.message);
    }

    const { data: rodada, error: erroDaLeitura } = await servico
      .from('ota_updates')
      .select('total, concluidas, falhas, status, error')
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
      const final = erro !== undefined || rodada.falhas > 0 ? 'errored' : 'finished';
      /*
       * A rodada aberta fecha. E a que fechou só pelas falhas das lojas — sem
       * erro da rodada inteira, e sem ter sido encerrada pela equipe — vira
       * publicada quando o job que falhou é reexecutado no GitHub e dá certo:
       * senão a tela diria "com falha" de uma rodada que chegou a todas.
       */
      const origens: Database['public']['Enums']['ota_status'][] =
        final === 'finished' && rodada.error === null
          ? ['queued', 'running', 'errored']
          : ['queued', 'running'];
      const { error: erroDoFim } = await servico
        .from('ota_updates')
        .update({
          status: final,
          error: erro,
          commit_sha: commitSha,
          finished_at: new Date().toISOString(),
        })
        .eq('id', otaId)
        .in('status', origens);
      // A rodada ficaria "publicando" para sempre, e travaria a próxima.
      if (erroDoFim != null) throw new Error(`fim da rodada: ${erroDoFim.message}`);
    } else if (commitSha !== undefined) {
      const { error: erroDoCommit } = await servico
        .from('ota_updates')
        .update({ commit_sha: commitSha })
        .eq('id', otaId);
      if (erroDoCommit != null) throw new Error(`commit da rodada: ${erroDoCommit.message}`);
    }
  } catch (erroDoBanco) {
    log.erro('ota-status.falhou', { erro: erroDoBanco });
    return NextResponse.json({ erro: 'indisponivel' }, { status: 503, headers: SEM_CACHE });
  }

  return NextResponse.json({ ok: true }, { headers: SEM_CACHE });
}

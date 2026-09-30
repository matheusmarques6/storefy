/**
 * `POST /api/public/push-avisos` — o que o pedido de permissão do app (M03)
 * pode prometer.
 *
 * A tela prometia sempre "pedido saiu para entrega" e "de volta ao estoque",
 * com as automações ligadas ou não. Agora o app pergunta aqui, antes de
 * mostrá-la, e lista só os avisos que a loja manda de verdade
 * (`respostaDosAvisosDoPush`).
 *
 * Assinado como as outras rotas do app. É POST pelo mesmo motivo da caixa de
 * avisos: a assinatura é sobre o corpo.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { buscarSegredoCifrado } from '@/lib/segredo-do-app';
import {
  CABECALHO_DA_ASSINATURA,
  CABECALHOS,
  CorpoDosAvisosDoPush,
  autorizar,
  respostaDosAvisosDoPush,
  type Resposta,
} from '@/lib/endpoint-do-app';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const resposta = await decidir(requisicao);
  if (resposta.motivo != null) {
    log.aviso('app-avisos-do-push.recusado', { motivo: resposta.motivo });
  }
  return NextResponse.json(resposta.corpo, {
    status: resposta.status,
    headers: CABECALHOS,
  });
}

async function decidir(requisicao: NextRequest): Promise<Resposta> {
  if (!supabaseConfigurado || !serviceRoleConfigurada) {
    return {
      status: 503,
      corpo: { erro: 'servidor_nao_configurado' },
      motivo: 'Supabase ou service role ausente',
    };
  }

  const corpoBruto = await requisicao.text();
  const autorizacao = await autorizar(
    CorpoDosAvisosDoPush,
    corpoBruto,
    requisicao.headers.get(CABECALHO_DA_ASSINATURA),
    buscarSegredoCifrado,
    Date.now(),
  );
  if (!autorizacao.ok) return autorizacao.resposta;

  try {
    const supabase = criarClientServiceRole();
    const { appId } = autorizacao.dados;
    const [automacoes, app] = await Promise.all([
      supabase.from('push_automations').select('type').eq('app_id', appId).eq('enabled', true),
      supabase
        .from('apps')
        .select('stores!inner(platform, shopify_scopes)')
        .eq('id', appId)
        .maybeSingle(),
    ]);

    const erro = automacoes.error ?? app.error;
    if (erro != null) {
      return { status: 503, corpo: { erro: 'indisponivel' }, motivo: erro.message };
    }
    return respostaDosAvisosDoPush(automacoes.data, app.data?.stores);
  } catch (erro) {
    // Nada escapa como a página de erro do Next, em HTML: o app não saberia ler.
    return {
      status: 503,
      corpo: { erro: 'indisponivel' },
      motivo: erro instanceof Error ? erro.message : 'falha desconhecida',
    };
  }
}

/**
 * `POST /api/public/test-device` — o app pareia o celular do lojista como
 * celular de teste (C08).
 *
 * O painel mostra um QR com o link do app e um código de uso único. A câmera
 * abre o app, e o app chama aqui com o código e a identidade do aparelho —
 * assinado com o segredo daquele app, como as outras rotas que ele escreve.
 * Toda a decisão (código certo, dentro do prazo, aparelho conhecido) é da
 * função do Postgres; aqui só sobra conferir a assinatura e responder.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { buscarSegredoCifrado } from '@/lib/segredo-do-app';
import {
  CABECALHO_DA_ASSINATURA,
  CABECALHOS,
  CorpoDoPareamento,
  autorizar,
  respostaDoPareamento,
  type Resposta,
} from '@/lib/endpoint-do-app';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const resposta = await decidir(requisicao);
  if (resposta.motivo != null) {
    // Só no nosso log. O corpo da resposta nunca explica a recusa.
    log.aviso('app-celular-de-teste.recusado', { motivo: resposta.motivo });
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
    CorpoDoPareamento,
    corpoBruto,
    requisicao.headers.get(CABECALHO_DA_ASSINATURA),
    buscarSegredoCifrado,
    Date.now(),
  );
  if (!autorizacao.ok) return autorizacao.resposta;

  const { appId, codigo, installId, subscriptionId } = autorizacao.dados;

  try {
    const supabase = criarClientServiceRole();
    const { data, error } = await supabase.rpc('parear_celular_de_teste', {
      p_app_id: appId,
      p_codigo: codigo,
      p_install_id: installId,
      p_subscription: subscriptionId,
    });

    if (error != null) {
      return { status: 503, corpo: { erro: 'indisponivel' }, motivo: error.message };
    }
    return respostaDoPareamento(data);
  } catch (erro) {
    // Nada escapa como a página de erro do Next, em HTML: o app não saberia ler.
    return {
      status: 503,
      corpo: { erro: 'indisponivel' },
      motivo: erro instanceof Error ? erro.message : 'falha desconhecida',
    };
  }
}

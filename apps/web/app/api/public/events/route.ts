/**
 * `POST /api/public/events` — o app conta o que aconteceu com o carrinho.
 *
 * Mesma autenticação do `/devices` e mesmo motivo de estar no banco: gravar o
 * evento e mexer na automação de carrinho abandonado são uma decisão só.
 * Carrinho gravado sem agendamento vira push que nunca sai; agendamento sem
 * evento vira push sem motivo.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { buscarSegredoCifrado } from '@/lib/segredo-do-app';
import {
  CABECALHO_DA_ASSINATURA,
  CABECALHOS,
  CorpoDoEvento,
  autorizar,
  lerLinhaDoEvento,
  type Resposta,
} from '@/lib/endpoint-do-app';

export const dynamic = 'force-dynamic';

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const resposta = await decidir(requisicao);
  if (resposta.motivo != null) {
    console.warn('[events] recusado:', resposta.motivo);
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
    CorpoDoEvento,
    corpoBruto,
    requisicao.headers.get(CABECALHO_DA_ASSINATURA),
    buscarSegredoCifrado,
    Date.now(),
  );
  if (!autorizacao.ok) return autorizacao.resposta;

  const { appId, subscriptionId, event, itemCount, cartToken, valueCents, currency } =
    autorizacao.dados;

  try {
    const supabase = criarClientServiceRole();
    const { data, error } = await supabase.rpc('registrar_evento_de_carrinho', {
      p_app_id: appId,
      p_subscription: subscriptionId,
      p_event: event,
      p_item_count: itemCount,
      p_cart_token: cartToken,
      p_value_cents: valueCents,
      p_currency: currency,
    });

    if (error != null) {
      return { status: 503, corpo: { erro: 'indisponivel' }, motivo: error.message };
    }
    return lerLinhaDoEvento(data);
  } catch (erro) {
    return {
      status: 503,
      corpo: { erro: 'indisponivel' },
      motivo: erro instanceof Error ? erro.message : 'falha desconhecida',
    };
  }
}

/**
 * `POST /api/public/back-in-stock` — "me avise quando voltar".
 *
 * Mesma autenticação dos outros endpoints públicos: assinatura do app sobre o
 * corpo cru. E a mesma razão de ser POST — a assinatura é sobre o corpo, e um
 * GET assinado poria os dados na URL, que entra em log de proxy, de CDN e de
 * servidor.
 *
 * O pedido vem de um botão na página do produto, DENTRO do app. O aparelho é
 * resolvido pela inscrição do OneSignal, e o banco confere de novo que ele é
 * deste app: o id do aparelho não viaja no corpo justamente para não haver o
 * que forjar.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { buscarSegredoCifrado } from '@/lib/segredo-do-app';
import {
  CABECALHO_DA_ASSINATURA,
  CABECALHOS,
  CorpoDoAviso,
  autorizar,
  type Resposta,
} from '@/lib/endpoint-do-app';

export const dynamic = 'force-dynamic';

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const resposta = await decidir(requisicao);
  if (resposta.motivo != null) {
    console.warn('[back-in-stock] recusado:', resposta.motivo);
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
    CorpoDoAviso,
    corpoBruto,
    requisicao.headers.get(CABECALHO_DA_ASSINATURA),
    buscarSegredoCifrado,
    Date.now(),
  );
  if (!autorizacao.ok) return autorizacao.resposta;

  const { appId, subscriptionId, variantId, path } = autorizacao.dados;

  try {
    const supabase = criarClientServiceRole();

    /*
     * O aparelho é achado pela inscrição, e não recebido pronto. Assim o único
     * jeito de inscrever alguém é ter a assinatura do app E a inscrição que o
     * OneSignal deu àquele aparelho.
     */
    const { data: aparelho, error: erroDoAparelho } = await supabase
      .from('devices')
      .select('id')
      .eq('app_id', appId)
      .eq('onesignal_subscription_id', subscriptionId)
      .maybeSingle();

    if (erroDoAparelho != null) {
      return { status: 503, corpo: { erro: 'indisponivel' }, motivo: erroDoAparelho.message };
    }
    if (aparelho == null) {
      // Aparelho que não conhecemos: 404 e não 400. O app reinstalado registra
      // de novo na próxima abertura, e aí o pedido funciona.
      return {
        status: 404,
        corpo: { erro: 'aparelho_desconhecido' },
        motivo: 'inscrição não encontrada neste app',
      };
    }

    const { data: novo, error } = await supabase.rpc('inscrever_de_volta', {
      p_app_id: appId,
      p_device_id: aparelho.id,
      p_variant_id: variantId,
      p_deep_link: path,
    });

    if (error != null) {
      return { status: 503, corpo: { erro: 'indisponivel' }, motivo: error.message };
    }

    /*
     * `novo: false` é sucesso: quem tocou duas vezes no botão já está na
     * lista. Responder erro faria o app mostrar falha para uma pessoa que
     * conseguiu exatamente o que queria.
     */
    return { status: 200, corpo: { novo } };
  } catch (erro) {
    return {
      status: 503,
      corpo: { erro: 'indisponivel' },
      motivo: erro instanceof Error ? erro.message : 'falha desconhecida',
    };
  }
}

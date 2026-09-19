/**
 * `POST /api/public/devices` — o app avisa que foi aberto neste aparelho.
 *
 * Sem sessão: quem chama é o app instalado no celular do cliente final da loja.
 * O que substitui a sessão é a assinatura HMAC com o segredo daquele app, e
 * toda a decisão de aceitar ou recusar está em `lib/endpoint-do-app.ts`, com
 * testes. Aqui só sobra ler o corpo, chamar e responder.
 *
 * A escrita é uma função do Postgres, e não um insert: registrar o aparelho e
 * agendar o push de boas-vindas são a mesma decisão, e separá-las em duas
 * chamadas cria o caso em que uma acontece e a outra não.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { buscarSegredoCifrado } from '@/lib/segredo-do-app';
import {
  CABECALHO_DA_ASSINATURA,
  CABECALHOS,
  CorpoDoAparelho,
  autorizar,
  lerLinhaDoAparelho,
  type Resposta,
} from '@/lib/endpoint-do-app';

export const dynamic = 'force-dynamic';

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const resposta = await decidir(requisicao);
  if (resposta.motivo != null) {
    // Só no nosso log. O corpo da resposta nunca explica a recusa.
    console.warn('[devices] recusado:', resposta.motivo);
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
    CorpoDoAparelho,
    corpoBruto,
    requisicao.headers.get(CABECALHO_DA_ASSINATURA),
    buscarSegredoCifrado,
    Date.now(),
  );
  if (!autorizacao.ok) return autorizacao.resposta;

  const { appId, subscriptionId, platform, appVersion, externalId, emailHash } = autorizacao.dados;

  try {
    const supabase = criarClientServiceRole();
    const { data, error } = await supabase.rpc('registrar_aparelho', {
      p_app_id: appId,
      p_subscription: subscriptionId,
      p_platform: platform,
      p_app_version: appVersion,
      p_external_id: externalId,
      p_email_hash: emailHash,
    });

    if (error != null) {
      return { status: 503, corpo: { erro: 'indisponivel' }, motivo: error.message };
    }
    return lerLinhaDoAparelho(data);
  } catch (erro) {
    /*
     * Nada pode escapar: uma exceção aqui viraria a página de erro do Next, em
     * HTML, e o app trataria como resposta inválida sem pista nenhuma.
     */
    return {
      status: 503,
      corpo: { erro: 'indisponivel' },
      motivo: erro instanceof Error ? erro.message : 'falha desconhecida',
    };
  }
}

/**
 * `GET /api/shopify/callback` — o retorno do OAuth da Shopify.
 *
 * Quatro conferências, e nenhuma é opcional:
 *
 *   a query foi ASSINADA pela Shopify com o segredo do app;
 *   o `shop` é mesmo `*.myshopify.com` — ele vira o host de uma chamada nossa,
 *   e sem esse crivo `?shop=evil.com` levaria o segredo do app para onde quem
 *   pediu escolheu;
 *   o `state` bate com o cookie `HttpOnly` que a rota de instalação gravou, o
 *   que impede alguém de forjar o retorno;
 *   a loja do cookie é a mesma que iniciou a conexão.
 *
 * O token nunca chega ao navegador: ele é cifrado e gravado pela service role,
 * porque `shopify_access_token_enc` é invisível até para o dono da loja.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criptografar, criptografiaConfigurada, iguaisEmTempoConstante } from '@/lib/cripto';
import { serviceRoleConfigurada, supabaseConfigurado, urlDoSite } from '@/lib/env';
import { ehDominioDeLoja, faltamEscopos } from '@/lib/shopify';
import { conferirHmacDaQuery } from '@/lib/shopify-assinatura';
import {
  escoposPedidos,
  registrarWebhooks,
  shopifyConfigurado,
  trocarCodePorToken,
} from '@/lib/shopify-servidor';
import { COOKIE_DO_STATE } from '@/app/api/shopify/install/route';
import { COOKIE_LOJA, COOKIE_ORG } from '@/lib/contexto';

export const dynamic = 'force-dynamic';

const UM_ANO = 60 * 60 * 24 * 365;

export async function GET(requisicao: NextRequest): Promise<NextResponse> {
  const voltar = (erro: string): NextResponse => {
    const resposta = NextResponse.redirect(new URL(`/integracoes?shopify=${erro}`, requisicao.url));
    resposta.cookies.delete(COOKIE_DO_STATE);
    return resposta;
  };

  if (!shopifyConfigurado() || !supabaseConfigurado || !serviceRoleConfigurada) {
    return voltar('nao_configurado');
  }
  if (!criptografiaConfigurada()) return voltar('nao_configurado');

  const parametros = requisicao.nextUrl.searchParams;
  const shop = (parametros.get('shop') ?? '').trim().toLowerCase();
  const code = parametros.get('code') ?? '';

  if (!ehDominioDeLoja(shop) || code === '') return voltar('retorno_invalido');
  if (!conferirHmacDaQuery(parametros, process.env.SHOPIFY_API_SECRET ?? '')) {
    console.warn('[shopify-callback] assinatura da query não confere');
    return voltar('retorno_invalido');
  }

  /*
   * O cookie carrega `state.storeId`. Conferir só o `state` provaria que a ida
   * partiu daqui, mas não DE QUAL LOJA — e o lojista com duas lojas abertas em
   * abas diferentes acabaria conectando a Shopify na errada.
   */
  const guardado = requisicao.cookies.get(COOKIE_DO_STATE)?.value ?? '';
  const [stateGuardado, storeId] = guardado.split('.');
  const stateRecebido = parametros.get('state') ?? '';

  if (
    stateGuardado == null ||
    stateGuardado === '' ||
    storeId == null ||
    storeId === '' ||
    !iguaisEmTempoConstante(stateGuardado, stateRecebido)
  ) {
    console.warn('[shopify-callback] state não confere');
    return voltar('retorno_invalido');
  }

  const troca = await trocarCodePorToken(shop, code);
  if (!troca.ok) {
    console.warn('[shopify-callback] troca falhou:', troca.motivo);
    return voltar('token');
  }

  /*
   * Escopo concedido a menos é detectado AGORA, na conexão, e não num job que
   * falha de madrugada. O token é guardado mesmo assim: metade das permissões
   * ainda serve para metade do produto, e a tela diz o que falta.
   */
  const faltando = faltamEscopos(escoposPedidos(), troca.escopos);

  try {
    const servico = criarClientServiceRole();
    const { data: loja, error } = await servico
      .from('stores')
      .update({
        shop_domain: shop,
        platform: 'shopify',
        shopify_access_token_enc: criptografar(troca.token),
        shopify_scopes: troca.escopos.split(',').filter((escopo) => escopo.trim() !== ''),
      })
      .eq('id', storeId)
      .select('id, org_id')
      .maybeSingle();

    if (error != null || loja == null) {
      console.error('[shopify-callback] não gravou:', error?.message ?? 'loja não encontrada');
      return voltar('erro');
    }

    /*
     * Os webhooks são registrados DEPOIS de o token estar salvo. Na ordem
     * inversa, uma falha no meio deixaria a Shopify mandando eventos para uma
     * loja que o nosso banco não sabe que está conectada.
     */
    const webhooks = await registrarWebhooks(
      shop,
      troca.token,
      `${urlDoSite()}/api/webhooks/shopify`,
    );

    if (webhooks.falharam.length > 0) {
      console.warn('[shopify-callback] webhooks não registrados:', webhooks.falharam.join(', '));
    }

    const aviso =
      faltando.length > 0 ? 'escopos' : webhooks.falharam.length > 0 ? 'parcial' : 'conectada';

    const resposta = NextResponse.redirect(
      new URL(`/integracoes?shopify=${aviso}`, requisicao.url),
    );
    resposta.cookies.delete(COOKIE_DO_STATE);

    /*
     * A loja ativa passa a ser a que acabou de conectar. Sem isto, quem tem
     * duas lojas e trocou de uma para a outra no meio do caminho voltaria para
     * a tela de integrações mostrando a OUTRA loja como desconectada — e a
     * conclusão óbvia seria que a conexão falhou.
     */
    for (const [nome, valor] of [
      [COOKIE_LOJA, loja.id],
      [COOKIE_ORG, loja.org_id],
    ] as const) {
      resposta.cookies.set(nome, valor, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: UM_ANO,
      });
    }

    return resposta;
  } catch (erro) {
    console.error(
      '[shopify-callback] falhou:',
      erro instanceof Error ? erro.message : 'desconhecido',
    );
    return voltar('erro');
  }
}

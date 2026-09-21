/**
 * `POST /api/shopify/install` — começa a conexão com a Shopify.
 *
 * POST, e não GET, porque esta rota ESCREVE: ela grava o domínio escolhido em
 * `stores.shop_domain`. Um GET que muda dado é disparável de fora com uma
 * `<img src>` numa página qualquer — e o cookie de sessão, que é `SameSite=lax`,
 * iria junto. Com POST o navegador não manda o cookie de outro site, e a
 * falsificação morre antes de chegar aqui.
 *
 * Exige SESSÃO e permissão na loja: sem isso, qualquer um mandaria o lojista
 * para uma tela de autorização com o nosso `client_id`, e a loja dele acabaria
 * conectada à loja de outra pessoa no nosso banco.
 *
 * O `state` é aleatório e viaja em cookie `HttpOnly` além da URL. É o que
 * impede alguém de forjar o retorno do OAuth: quem não conseguiu iniciar não
 * tem o cookie, e o callback recusa.
 */
import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { urlDoSite } from '@/lib/env';
import { normalizarDominio, urlDeAutorizacao } from '@/lib/shopify';
import { escoposPedidos, shopifyConfigurado } from '@/lib/shopify-servidor';

export const dynamic = 'force-dynamic';

/** O cookie vive só o tempo de ir à Shopify e voltar. */
export const COOKIE_DO_STATE = 'storefy_shopify_state';
const VIDA_DO_COOKIE_S = 10 * 60;

/**
 * 303, e não o 307 que o `redirect` usa por padrão.
 *
 * O 307 preserva o método, e o navegador repetiria o POST — inclusive contra a
 * tela de autorização da Shopify, que responde a GET. O 303 diz "vá com GET".
 */
const VEJA_ALI = 303;

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const { lojaAtiva, papel } = await exigirContextoCliente();

  const voltar = (erro: string): NextResponse =>
    NextResponse.redirect(new URL(`/integracoes?shopify=${erro}`, requisicao.url), VEJA_ALI);

  if (lojaAtiva == null) return voltar('sem_loja');
  if (papel !== 'owner' && papel !== 'admin') return voltar('sem_permissao');
  if (!shopifyConfigurado()) return voltar('nao_configurado');

  const formulario = await requisicao.formData();
  const digitado = formulario.get('shop');
  const shop = normalizarDominio(typeof digitado === 'string' ? digitado : '');
  if (shop === null) return voltar('dominio_invalido');

  /*
   * A loja fica guardada com o `state`, e não só na sessão: o retorno do OAuth
   * chega numa navegação de cima, e depender do seletor de loja ativa faria a
   * conexão cair na loja errada se o lojista trocasse de aba no meio.
   */
  const state = randomBytes(24).toString('base64url');

  const supabase = await criarClientServidor();
  const { error } = await supabase
    .from('stores')
    .update({ shop_domain: shop })
    .eq('id', lojaAtiva.id);
  if (error != null) return voltar('erro');

  const destino = urlDeAutorizacao({
    shop,
    clientId: process.env.SHOPIFY_API_KEY ?? '',
    escopos: escoposPedidos(),
    urlDeRetorno: `${urlDoSite()}/api/shopify/callback`,
    state,
  });

  const resposta = NextResponse.redirect(destino, VEJA_ALI);
  resposta.cookies.set(COOKIE_DO_STATE, `${state}.${lojaAtiva.id}`, {
    httpOnly: true,
    // Em desenvolvimento o painel roda em http, e um cookie `secure` não seria
    // gravado — a conexão falharia no retorno com "state não confere".
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: VIDA_DO_COOKIE_S,
  });
  return resposta;
}

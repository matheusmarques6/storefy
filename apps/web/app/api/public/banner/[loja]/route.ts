/**
 * `GET /api/public/banner/<dominio>` — o convite para baixar o app.
 *
 * Quem chama é o bloco da Theme App Extension, rodando no site da loja. Ele
 * conhece só o domínio — `shop.permanent_domain`, que o Liquid entrega de
 * graça — e pergunta aqui o resto: se o banner está ligado, o texto e os links
 * das lojas de aplicativos.
 *
 * SEM SESSÃO E SEM SEGREDO, de propósito: tudo o que sai daqui já é público —
 * o app do lojista está na App Store e na Play Store, com esses mesmos
 * identificadores. O que não sai é igualmente proposital: nada de id de loja,
 * de app ou de organização, que transformariam este endereço numa forma de
 * enumerar os clientes da Storefy.
 *
 * O cache da borda é o que impede este endereço de virar uma consulta por
 * visitante da loja: um minuto cobre a rajada de quem está navegando agora, e
 * o lojista vê a mudança no minuto seguinte.
 */
import { NextResponse } from 'next/server';
import { safeParseAppConfig } from '@storefy/config-schema';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { montarBanner, type DadosDoBanner, type RespostaDoBanner } from '@/lib/banner-do-app';
import { ehDominioDeLoja } from '@/lib/shopify';

export const dynamic = 'force-dynamic';

const CABECALHOS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
  /*
   * O bloco roda no domínio da loja, que é outro domínio. Sem CORS o navegador
   * descarta a resposta antes de o JavaScript vê-la — e o banner simplesmente
   * nunca apareceria, sem erro nenhum na tela do lojista.
   */
  'Access-Control-Allow-Origin': '*',
} as const;

/** Banner desligado é uma resposta NORMAL, e não um erro. */
const DESLIGADO: RespostaDoBanner = {
  ativo: false,
  texto: '',
  ios: null,
  android: null,
  smartBanner: null,
};

export async function GET(
  _requisicao: Request,
  contexto: { params: Promise<{ loja: string }> },
): Promise<NextResponse> {
  const { loja } = await contexto.params;

  /*
   * Domínio que não é de loja Shopify nem chega ao banco. Ele vem da URL, e
   * sem esse crivo este endereço viraria uma consulta livre por texto na
   * tabela de lojas.
   */
  const dominio = decodeURIComponent(loja).trim().toLowerCase();
  if (!ehDominioDeLoja(dominio)) {
    return NextResponse.json(DESLIGADO, { headers: CABECALHOS });
  }

  if (!supabaseConfigurado || !serviceRoleConfigurada) {
    return NextResponse.json(DESLIGADO, { headers: CABECALHOS });
  }

  try {
    const dados = await buscar(dominio);
    return NextResponse.json(montarBanner(dados), { headers: CABECALHOS });
  } catch (erro) {
    console.error('[banner] falhou:', erro instanceof Error ? erro.message : 'desconhecido');
    // Desligado, e não 500: uma falha nossa não pode quebrar o site da loja.
    return NextResponse.json(DESLIGADO, { headers: CABECALHOS });
  }
}

async function buscar(dominio: string): Promise<DadosDoBanner | null> {
  const servico = criarClientServiceRole();

  const { data: loja } = await servico
    .from('stores')
    .select('id')
    .eq('shop_domain', dominio)
    .maybeSingle();
  if (loja == null) return null;

  const { data: app } = await servico
    .from('apps')
    .select('id, ios_asc_app_id, package_android, current_config_version')
    .eq('store_id', loja.id)
    .maybeSingle();
  if (app == null) return null;

  /*
   * O texto vem da config PUBLICADA, e não do rascunho: o que está na vitrine
   * do lojista tem que ser o que ele publicou, e não o que ele está editando
   * agora no painel.
   */
  const { data: linha } = await servico
    .from('app_configs')
    .select('config')
    .eq('app_id', app.id)
    .eq('status', 'published')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const analise = linha == null ? null : safeParseAppConfig(linha.config);
  const banner = analise?.success === true ? analise.data.features.appBanner : null;

  return {
    ligado: banner?.enabled ?? false,
    texto: banner?.text ?? '',
    appStoreId: app.ios_asc_app_id,
    pacoteAndroid: app.package_android,
  };
}

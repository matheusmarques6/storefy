/**
 * `GET /api/preview-proxy?loja=<id>&caminho=/...` — a loja dentro da prévia.
 *
 * Existe por dois motivos que o iframe apontado direto para o site não resolve:
 * muitas lojas mandam `X-Frame-Options` e a prévia ficaria em branco sem dizer
 * por quê; e o seletor visual precisa que o documento tenha a nossa origem para
 * poder tocar nele.
 *
 * NÃO É UM PROXY ABERTO. Exige sessão, a loja precisa ser de uma organização do
 * usuário (quem filtra é a RLS), o alvo sai do endereço cadastrado no BANCO —
 * nunca de uma URL do navegador — e hospedeiro interno é recusado antes de a
 * requisição sair. As regras estão em `lib/preview-proxy.ts`, com testes.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServidor } from '@/lib/supabase/server';
import {
  cssDaPrevia,
  destinoDaPrevia,
  ehHostPublico,
  dominioPermitido,
  gerarScriptDaPrevia,
  prepararHtmlDaPrevia,
} from '@/lib/preview-proxy';
import { dominiosDaLoja } from '@storefy/config-schema';

export const dynamic = 'force-dynamic';

/** A loja pode demorar; a prévia não pode pendurar uma conexão do servidor. */
const TEMPO_LIMITE_MS = 10_000;
/** Teto do documento. Página de loja passa longe disso; um laço, não. */
const TAMANHO_MAXIMO = 4 * 1024 * 1024;
/** Redirecionamentos seguidos à mão, para conferir cada salto. */
const MAX_SALTOS = 3;

/**
 * Um `User-Agent` de navegador de verdade.
 *
 * Com o padrão do `fetch` do Node, muita loja devolve a página de bot, e o
 * lojista veria uma prévia que não é a loja dele.
 */
const AGENTE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 StorefyPreview';

function erro(status: number, mensagem: string): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><body style="font:14px/1.5 system-ui;padding:24px;color:#374151">${mensagem}</body>`,
    {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    },
  );
}

export async function GET(requisicao: NextRequest): Promise<NextResponse> {
  const lojaId = requisicao.nextUrl.searchParams.get('loja') ?? '';
  const caminho = requisicao.nextUrl.searchParams.get('caminho') ?? '/';

  const supabase = await criarClientServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user == null) return erro(401, 'Faça login no painel para ver a prévia.');

  // A RLS decide: quem não é da organização da loja simplesmente não a acha.
  const { data: loja } = await supabase
    .from('stores')
    .select('primary_url, shop_domain')
    .eq('id', lojaId)
    .maybeSingle();

  if (loja == null) return erro(404, 'Loja não encontrada.');

  const dominios = dominiosDaLoja(loja.primary_url, loja.shop_domain);
  const destino = destinoDaPrevia(loja.primary_url, caminho, dominios);
  if (!destino.ok) return erro(400, destino.motivo);

  /*
   * Os seletores vêm na URL só para a PRIMEIRA pintura não piscar com o
   * cabeçalho do tema aparecendo. Depois disso quem manda é o `postMessage` do
   * painel, que atualiza sem recarregar a loja a cada tecla digitada.
   */
  const seletores = requisicao.nextUrl.searchParams.getAll('esconder');

  let alvo = destino.url;
  let resposta: Response;
  const cancelador = new AbortController();
  const alarme = setTimeout(() => {
    cancelador.abort();
  }, TEMPO_LIMITE_MS);

  try {
    for (let salto = 0; ; salto += 1) {
      resposta = await fetch(alvo, {
        signal: cancelador.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': AGENTE,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': requisicao.headers.get('accept-language') ?? 'pt-BR,pt;q=0.9',
        },
      });

      if (resposta.status < 300 || resposta.status >= 400) break;

      const local = resposta.headers.get('location');
      if (local == null || salto >= MAX_SALTOS) {
        return erro(502, 'A loja redirecionou para um endereço que não conseguimos seguir.');
      }

      /*
       * Cada salto é reconferido. Um `Location` para `169.254.169.254` é o
       * jeito clássico de contornar a validação feita só na primeira URL.
       */
      const proximo = new URL(local, alvo);
      if (
        (proximo.protocol !== 'http:' && proximo.protocol !== 'https:') ||
        !ehHostPublico(proximo.hostname) ||
        !dominioPermitido(proximo.hostname, dominios)
      ) {
        return erro(400, 'A loja redirecionou para fora dela. A prévia só abre a sua loja.');
      }
      alvo = proximo.toString();
    }
  } catch {
    return erro(504, 'Não conseguimos carregar a sua loja agora. Tente de novo em instantes.');
  } finally {
    clearTimeout(alarme);
  }

  const tipo = resposta.headers.get('content-type') ?? '';
  if (!tipo.toLowerCase().includes('html')) {
    return erro(415, 'Este endereço não é uma página da loja.');
  }

  const bruto = await resposta.arrayBuffer();
  if (bruto.byteLength > TAMANHO_MAXIMO) {
    return erro(413, 'Esta página é grande demais para a prévia.');
  }

  const html = new TextDecoder('utf-8').decode(bruto);
  const preparado = prepararHtmlDaPrevia(html, {
    base: alvo,
    css: cssDaPrevia(seletores),
    js: gerarScriptDaPrevia(),
  });

  return new NextResponse(preparado, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // A prévia é do estado de agora; guardar faria o lojista mexer numa
      // configuração e ver a anterior.
      'Cache-Control': 'no-store',
      // Só o nosso painel pode enquadrar isto.
      'Content-Security-Policy': "frame-ancestors 'self'",
      'X-Content-Type-Options': 'nosniff',
      // A loja é de terceiro; o referrer não precisa contar de onde veio.
      'Referrer-Policy': 'no-referrer',
    },
  });
}

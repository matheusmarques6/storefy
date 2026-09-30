import { NextResponse } from 'next/server';

/**
 * Redireciona para um caminho DESTE site, com `Location` relativo.
 *
 * `new URL(caminho, requisicao.url)` parece a mesma coisa e não é: dentro de
 * uma rota, `requisicao.url` traz o host em que o servidor escuta —
 * `localhost` no `next start` —, e não o que o navegador pediu. O redirect
 * saía para outro host, sem a sessão, e a pessoa caía no login. O e2e pegou
 * na visita ao painel do cliente; as rotas da Shopify tinham o mesmo defeito.
 *
 * O navegador resolve um `Location` relativo contra o endereço que ELE pediu
 * (RFC 9110, seção 10.2.2) — que é sempre o certo, atrás de qualquer proxy.
 *
 * 303 por padrão: depois de um POST, o navegador segue com GET. Só aceita
 * caminho deste site (`caminhoDoSite`): `//outro.site` seria um redirect para
 * fora disfarçado de caminho.
 */
export function redirecionarPara(caminho: string, status: 302 | 303 = 303): NextResponse {
  const seguro = caminhoDoSite(caminho);
  if (seguro === null) throw new Error(`Redirect só para caminho deste site: ${caminho}`);
  return new NextResponse(null, { status, headers: { Location: seguro } });
}

/** Uma origem que não existe, só para o leitor de URL resolver o caminho contra ela. */
const ORIGEM_DE_REFERENCIA = 'https://storefy.invalid';

/**
 * O caminho, se ele for DESTE site, como o navegador o leria; `null` se não for.
 *
 * Conferir o texto não basta. Para o navegador, `//outro.site` é outro site,
 * `/\outro.site` também (a barra invertida vira barra), um TAB ou uma quebra
 * de linha no meio somem antes da leitura (`/<TAB>/outro.site` vira
 * `//outro.site`), e `/..//outro.site` se resolve em `//outro.site`. Por isso
 * o caminho passa pelo mesmo leitor de URL do navegador (WHATWG), e só vale se
 * continuar aqui — e se o que ele leu não começar, de novo, com duas barras.
 */
export function caminhoDoSite(bruto: string): string | null {
  if (!bruto.startsWith('/') || !URL.canParse(bruto, ORIGEM_DE_REFERENCIA)) return null;
  const url = new URL(bruto, ORIGEM_DE_REFERENCIA);
  const caminho = `${url.pathname}${url.search}${url.hash}`;
  return url.origin === ORIGEM_DE_REFERENCIA && !caminho.startsWith('//') ? caminho : null;
}

/**
 * Para onde ir depois de entrar: o `proximo` que veio da URL (do login ou do
 * link do e-mail), se for caminho deste site, ou o início. Um `proximo` de
 * fora é o golpe clássico: o link para a página de login VERDADEIRA que, depois
 * da senha, leva a pessoa a uma cópia da Storefy.
 */
export function destinoSeguro(bruto: unknown): string {
  return typeof bruto === 'string' ? (caminhoDoSite(bruto) ?? '/') : '/';
}

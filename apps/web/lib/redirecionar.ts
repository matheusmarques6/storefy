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
 * caminho começando com uma barra só — `//outro.site` seria um redirect para
 * fora disfarçado de caminho.
 */
export function redirecionarPara(caminho: string, status: 302 | 303 = 303): NextResponse {
  if (!caminho.startsWith('/') || caminho.startsWith('//') || caminho.startsWith('/\\')) {
    throw new Error(`Redirect só para caminho deste site: ${caminho}`);
  }
  return new NextResponse(null, { status, headers: { Location: caminho } });
}

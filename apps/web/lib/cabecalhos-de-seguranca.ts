/**
 * Os cabeçalhos de segurança de toda resposta do painel, do admin e das
 * páginas públicas (seção 8 do plano: revisão de segurança). Entram pelo
 * `next.config.ts`, e valem até para a página de erro e os arquivos estáticos.
 *
 * - `frame-ancestors 'self'` (e o `X-Frame-Options`, para navegador antigo):
 *   nenhum site de fora põe o painel dentro de um iframe. É o golpe do clique
 *   roubado — um "Publicar agora" ou "Excluir loja" escondido por baixo de uma
 *   página disfarçada. Só o próprio painel enquadra o que é dele.
 * - `object-src 'none'` e `base-uri 'self'`: nada de plugin, e um `<base>`
 *   injetado não manda os links e scripts da página para outro site.
 * - `nosniff`: o navegador não "adivinha" o tipo de um arquivo — texto não
 *   vira script.
 * - `Referrer-Policy`: para fora, só a origem. O caminho, com o id da loja ou
 *   da campanha, não vaza para os sites que o painel abre.
 * - `Permissions-Policy`: câmera, microfone, localização e o rastreio de
 *   interesses do navegador desligados — o painel não usa, e a loja que
 *   aparece na prévia não ganha acesso a eles.
 * - HSTS: dois anos só por HTTPS, sem a volta ao HTTP que uma rede
 *   mal-intencionada tentaria forçar.
 */
export const CABECALHOS_DE_SEGURANCA: readonly { key: string; value: string }[] = [
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
  },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

/**
 * Todo caminho, menos a prévia da loja (`/api/preview-proxy`): ela é o HTML
 * da LOJA, com um `<base>` apontando para a loja — que `base-uri 'self'`
 * quebraria — e com os cabeçalhos dela mesma, que só deixam o painel a
 * enquadrar.
 */
export const CAMINHOS_COM_CABECALHOS = '/((?!api/preview-proxy).*)';

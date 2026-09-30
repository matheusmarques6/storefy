/**
 * Todo link que abre o app vai para a tela da loja.
 *
 * O app tem UMA rota (`index`); quem decide o que fazer com o link é a loja
 * (`src/telas/loja.tsx`, pelo `Linking`): o caminho de um produto vai para a
 * aba certa, e o QR do celular de teste abre o pareamento (C08). Sem isto, o
 * expo-router procuraria uma rota para `/products/jaqueta` ou para
 * `/celular-de-teste` — que não existem — e mostraria a tela de "rota não
 * encontrada" no lugar da loja: todo link da loja aberto pelo celular
 * (Universal Links, App Links, o QR do painel) cairia nela.
 */
export function redirectSystemPath(): string {
  return '/';
}

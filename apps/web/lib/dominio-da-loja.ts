/**
 * O `shop_domain` que a edição da loja grava.
 *
 * Enquanto a loja não foi conectada, o campo guarda o host do endereço do
 * site — o cadastro põe ali, e ele entra na lista de domínios que o app abre.
 * Depois da conexão, é o `.myshopify.com`: a identidade da loja nos webhooks
 * da Shopify. Esse fica. Trocar o nome ou o e-mail de atendimento regravava o
 * domínio com o host do site, e os pedidos de uma loja conectada sumiam do
 * painel sem erro nenhum (migration 58). A loja desconectada também guarda o
 * dela: é o que preenche o campo na hora de reconectar.
 *
 * `undefined` quer dizer "não mexer".
 */
export function dominioAoEditar(atual: string | null, urlDaLoja: string): string | undefined {
  if (atual !== null && ehDominioDaShopify(atual)) return undefined;
  return new URL(urlDaLoja).hostname;
}

/** `minha-loja.myshopify.com`, em qualquer caixa. */
export function ehDominioDaShopify(dominio: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(dominio.trim());
}

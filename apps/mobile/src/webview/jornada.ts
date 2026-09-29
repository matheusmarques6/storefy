/**
 * O que o endereço de cada página conta sobre a compra (seções 5.6 e 5.7).
 *
 * O checkout da Shopify não é do tema: o lojista não tem como pôr código lá, e
 * a página de "obrigado" não avisa ninguém. O que o app vê SEMPRE é o endereço
 * de cada página — e é ele que diz que o cliente entrou no checkout, que a
 * compra terminou e que ele saiu da conta.
 *
 * Sem isto, três coisas que o painel oferece não aconteceriam nunca: o pedido
 * de avaliação depois da compra, o evento que cancela o push de carrinho
 * abandonado de quem acabou de pagar, e o token do carrinho que liga o pedido
 * da Shopify ao aparelho que o fez.
 */
import { ehCheckout } from '@storefy/bridge';

/** Os nomes que a página de "obrigado" já teve no checkout da Shopify. */
const PAGINAS_DE_OBRIGADO = new Set(['thank_you', 'thank-you']);

function lerUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Os pedaços do caminho, com a caixa original: o token do checkout a tem. */
function segmentos(url: URL): string[] {
  return url.pathname.split('/').filter((parte) => parte !== '');
}

/**
 * A compra terminou nesta página? Devolve a chave do checkout, para a mesma
 * compra contar UMA vez — a página de obrigado recarrega, volta pelo histórico
 * e avisa mais de uma vez que mudou de endereço.
 *
 * Cobre o checkout antigo (`/checkouts/<token>/thank_you`, com ou sem o id da
 * loja na frente) e o novo (`/checkouts/c/<token>/thank-you`). A página de
 * status do pedido (`/orders/<token>`) NÃO conta: ela abre de novo pelo
 * e-mail, dias depois, e cada visita viraria uma compra.
 */
export function compraConcluidaNaUrl(url: string): string | null {
  const alvo = lerUrl(url);
  if (alvo === null) return null;

  const partes = segmentos(alvo);
  const ultima = partes.length - 1;
  const checkouts = partes.findIndex((parte) => parte.toLowerCase() === 'checkouts');
  // Entre `checkouts` e o obrigado tem de haver o token do checkout.
  if (checkouts < 0 || ultima - checkouts < 2) return null;
  if (!PAGINAS_DE_OBRIGADO.has((partes[ultima] ?? '').toLowerCase())) return null;

  return partes[ultima - 1] ?? null;
}

/** A página é do checkout, antes do obrigado? */
export function entrouNoCheckout(url: string): boolean {
  const alvo = lerUrl(url);
  if (alvo === null) return false;
  return ehCheckout(alvo) && compraConcluidaNaUrl(url) === null;
}

/**
 * O cliente saiu da conta? `/account/logout` da loja (também com o idioma dos
 * mercados da Shopify, `/en/account/logout`) e as saídas da conta nova, em
 * `shopify.com`: `/<id da loja>/account/logout` e
 * `/authentication/<id da loja>/logout`.
 */
export function saiuDaConta(url: string): boolean {
  const alvo = lerUrl(url);
  if (alvo === null) return false;
  const caminho = segmentos(alvo).join('/').toLowerCase();
  return (
    /^(?:[a-z]{2}(?:-[a-z0-9]{2,4})?\/|\d+\/)?account\/logout$/.test(caminho) ||
    /^authentication\/\d+\/logout$/.test(caminho)
  );
}

/**
 * Vibra ao mudar o carrinho? Só quando AUMENTA, e nunca na primeira leitura:
 * cada aba lê o carrinho quando abre, e o app vibrar sozinho ao abrir, com um
 * carrinho de ontem, seria defeito.
 */
export function vibrarNoCarrinho(anterior: number | null, atual: number): boolean {
  return anterior !== null && atual > anterior;
}

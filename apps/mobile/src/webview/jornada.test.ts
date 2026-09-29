import { describe, expect, it } from 'vitest';
import { compraConcluidaNaUrl, entrouNoCheckout, saiuDaConta, vibrarNoCarrinho } from './jornada';

const LOJA = 'https://oakvintage.com.br';

describe('a compra terminou', () => {
  it('no checkout novo da Shopify', () => {
    expect(compraConcluidaNaUrl(`${LOJA}/checkouts/c/Z2NwLXVzLWVhc3Q/thank-you`)).toBe(
      'Z2NwLXVzLWVhc3Q',
    );
    expect(compraConcluidaNaUrl(`${LOJA}/checkouts/cn/Z2NwLXVz/thank-you?locale=pt-BR`)).toBe(
      'Z2NwLXVz',
    );
  });

  it('no checkout antigo, com ou sem o id da loja na frente', () => {
    expect(compraConcluidaNaUrl(`${LOJA}/checkouts/abc123/thank_you`)).toBe('abc123');
    expect(compraConcluidaNaUrl(`${LOJA}/5678/checkouts/abc123/thank_you/`)).toBe('abc123');
    expect(compraConcluidaNaUrl('https://checkout.shopify.com/5678/checkouts/abc/thank_you')).toBe(
      'abc',
    );
  });

  it('não confunde com as outras etapas do checkout', () => {
    for (const etapa of [
      `${LOJA}/checkouts/c/abc`,
      `${LOJA}/checkouts/c/abc/processing`,
      `${LOJA}/checkouts/abc?step=payment_method`,
      `${LOJA}/checkouts/thank-you`,
      `${LOJA}/checkout`,
    ]) {
      expect(compraConcluidaNaUrl(etapa)).toBeNull();
    }
  });

  it('a página de status do pedido NÃO é uma compra nova', () => {
    // Ela abre de novo pelo e-mail, dias depois.
    expect(compraConcluidaNaUrl(`${LOJA}/5678/orders/abc123`)).toBeNull();
    expect(compraConcluidaNaUrl(`${LOJA}/account/orders/123`)).toBeNull();
  });

  it('nem uma página da loja que fala em obrigado', () => {
    expect(compraConcluidaNaUrl(`${LOJA}/pages/thank-you`)).toBeNull();
    expect(compraConcluidaNaUrl('não é url')).toBeNull();
  });
});

describe('entrou no checkout', () => {
  it('as etapas antes do obrigado', () => {
    expect(entrouNoCheckout(`${LOJA}/checkout`)).toBe(true);
    expect(entrouNoCheckout(`${LOJA}/checkouts/c/abc`)).toBe(true);
    expect(entrouNoCheckout('https://checkout.shopify.com/5678/checkouts/abc')).toBe(true);
  });

  it('o obrigado já é a compra, e o carrinho ainda não é o checkout', () => {
    expect(entrouNoCheckout(`${LOJA}/checkouts/c/abc/thank-you`)).toBe(false);
    expect(entrouNoCheckout(`${LOJA}/cart`)).toBe(false);
    expect(entrouNoCheckout(`${LOJA}/products/checkout-bag`)).toBe(false);
  });
});

describe('saiu da conta', () => {
  it('o endereço de sair da Shopify, em qualquer idioma', () => {
    expect(saiuDaConta(`${LOJA}/account/logout`)).toBe(true);
    expect(saiuDaConta(`${LOJA}/account/logout/`)).toBe(true);
    expect(saiuDaConta(`${LOJA}/en/account/logout`)).toBe(true);
    expect(saiuDaConta(`${LOJA}/pt-pt/Account/Logout`)).toBe(true);
  });

  it('as saídas da conta nova da Shopify', () => {
    expect(saiuDaConta('https://shopify.com/12345/account/logout')).toBe(true);
    expect(saiuDaConta('https://shopify.com/authentication/12345/logout?return_to=/')).toBe(true);
  });

  it('não confunde com o resto da conta', () => {
    expect(saiuDaConta(`${LOJA}/account`)).toBe(false);
    expect(saiuDaConta(`${LOJA}/account/login`)).toBe(false);
    expect(saiuDaConta(`${LOJA}/pages/account/logout`)).toBe(false);
  });
});

describe('vibrar no carrinho', () => {
  it('só quando aumenta', () => {
    expect(vibrarNoCarrinho(1, 2)).toBe(true);
    expect(vibrarNoCarrinho(2, 2)).toBe(false);
    expect(vibrarNoCarrinho(3, 1)).toBe(false);
  });

  it('nunca na primeira leitura, que é o carrinho que já existia', () => {
    expect(vibrarNoCarrinho(null, 3)).toBe(false);
  });
});

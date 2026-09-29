import { describe, expect, it } from 'vitest';
import { dominioAoEditar, ehDominioDaShopify } from '@/lib/dominio-da-loja';

describe('dominioAoEditar', () => {
  /*
   * O domínio da Shopify é por onde os webhooks acham a loja. Regravá-lo com
   * o host do site numa troca de e-mail fazia os pedidos sumirem do painel.
   */
  it('não mexe no domínio da Shopify, conectada ou não', () => {
    expect(dominioAoEditar('oak-vintage.myshopify.com', 'https://oakvintage.com.br')).toBe(
      undefined,
    );
    expect(dominioAoEditar('OAK.MyShopify.com', 'https://outra.com.br')).toBe(undefined);
  });

  it('o host provisório do cadastro acompanha o endereço do site', () => {
    expect(dominioAoEditar('oakvintage.com.br', 'https://www.oak.com.br/loja')).toBe(
      'www.oak.com.br',
    );
    expect(dominioAoEditar(null, 'https://oak.com.br')).toBe('oak.com.br');
  });
});

describe('ehDominioDaShopify', () => {
  it('reconhece o .myshopify.com e só ele', () => {
    expect(ehDominioDaShopify('minha-loja.myshopify.com')).toBe(true);
    expect(ehDominioDaShopify(' minha-loja.myshopify.com ')).toBe(true);
    expect(ehDominioDaShopify('myshopify.com')).toBe(false);
    expect(ehDominioDaShopify('loja.myshopify.com.br')).toBe(false);
    expect(ehDominioDaShopify('loja.com.br')).toBe(false);
  });
});

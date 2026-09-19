import { describe, expect, it } from 'vitest';
import { decidirNavegacao } from './navegacao';

const LOJA = 'https://oakvintage.com.br';
const DOMINIOS = ['oakvintage.com.br'];

describe('decidirNavegacao', () => {
  it('NÃO trata o alvo como domínio permitido', () => {
    // A armadilha: passar a própria URL alvo como "onde estou" faria todo
    // link virar mesmo domínio, e o Instagram abriria dentro do app.
    for (const fora of [
      'https://instagram.com/oakvintage',
      'https://wa.me/5511999999999',
      'https://concorrente.com.br/promo',
    ]) {
      expect(decidirNavegacao(fora, `${LOJA}/products/x`, DOMINIOS)).toEqual({
        destino: 'externo',
        url: fora,
      });
    }
  });

  it('fica na WebView dentro da loja', () => {
    expect(decidirNavegacao(`${LOJA}/collections/novidades`, `${LOJA}/`, DOMINIOS).destino).toBe(
      'webview',
    );
  });

  it('resolve link relativo contra a página atual', () => {
    expect(decidirNavegacao('/cart', `${LOJA}/products/jaqueta`, DOMINIOS).destino).toBe('webview');
    expect(decidirNavegacao('../colecoes', `${LOJA}/products/jaqueta`, DOMINIOS).destino).toBe(
      'webview',
    );
  });

  it('segura o checkout na mesma WebView mesmo em host da Shopify', () => {
    // Mandar o checkout para o navegador perde os cookies de sessão, e o
    // cliente chega ao pagamento com o carrinho vazio.
    expect(decidirNavegacao(`${LOJA}/checkouts/abc123`, `${LOJA}/cart`, DOMINIOS).destino).toBe(
      'webview',
    );
    expect(
      decidirNavegacao('https://checkout.shopify.com/c/abc', `${LOJA}/cart`, DOMINIOS).destino,
    ).toBe('webview');
  });

  it('continua navegando num subdomínio que o lojista não listou', () => {
    // É para isso que a URL atual entra na lista de permitidos.
    expect(
      decidirNavegacao('https://blog.oakvintage.com.br/post', 'https://blog.oakvintage.com.br/', [])
        .destino,
    ).toBe('webview');
  });

  it('bloqueia esquema que só serve para ataque', () => {
    expect(decidirNavegacao('javascript:alert(1)', `${LOJA}/`, DOMINIOS).destino).toBe('bloquear');
    expect(decidirNavegacao('data:text/html,<h1>x', `${LOJA}/`, DOMINIOS).destino).toBe('bloquear');
  });

  it('manda tel: e mailto: para o sistema', () => {
    expect(decidirNavegacao('tel:+5511999999999', `${LOJA}/`, DOMINIOS).destino).toBe('externo');
    expect(decidirNavegacao('mailto:contato@oakvintage.com.br', `${LOJA}/`, DOMINIOS).destino).toBe(
      'externo',
    );
  });
});

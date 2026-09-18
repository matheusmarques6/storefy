import { describe, expect, it } from 'vitest';
import { destinoDoLink, ehCheckout, mesmoDominio, type ContextoDoLink } from './links';

const contexto: ContextoDoLink = {
  urlAtual: 'https://minha-loja.com.br/produtos/camiseta',
  dominios: ['minha-loja.com.br', 'cdn.minha-loja.com.br', 'minha-loja.myshopify.com'],
};

describe('mesmoDominio', () => {
  it('aceita o domínio exato', () => {
    expect(mesmoDominio('minha-loja.com.br', 'minha-loja.com.br')).toBe(true);
  });

  it('ignora www e diferença de caixa', () => {
    expect(mesmoDominio('WWW.Minha-Loja.com.BR', 'minha-loja.com.br')).toBe(true);
  });

  it('aceita subdomínio', () => {
    expect(mesmoDominio('cdn.minha-loja.com.br', 'minha-loja.com.br')).toBe(true);
  });

  it('RECUSA domínio que apenas termina igual', () => {
    // O bug clássico de `endsWith`: sem limite de ponto, este host passaria.
    expect(mesmoDominio('evilminha-loja.com.br', 'minha-loja.com.br')).toBe(false);
  });

  it('RECUSA o domínio usado como prefixo de outro', () => {
    // Phishing comum: o domínio real aparece no começo, mas o dono é outro.
    expect(mesmoDominio('minha-loja.com.br.evil.com', 'minha-loja.com.br')).toBe(false);
  });

  it('recusa host vazio', () => {
    expect(mesmoDominio('', 'minha-loja.com.br')).toBe(false);
    expect(mesmoDominio('minha-loja.com.br', '')).toBe(false);
  });
});

describe('destinoDoLink — fica na WebView', () => {
  it('link relativo', () => {
    expect(destinoDoLink('/colecoes/promo', contexto)).toEqual({ destino: 'webview' });
    expect(destinoDoLink('camiseta-azul', contexto)).toEqual({ destino: 'webview' });
  });

  it('mesmo domínio, em absoluto', () => {
    expect(destinoDoLink('https://minha-loja.com.br/conta', contexto)).toEqual({
      destino: 'webview',
    });
  });

  it('variante com www', () => {
    expect(destinoDoLink('https://www.minha-loja.com.br/', contexto)).toEqual({
      destino: 'webview',
    });
  });

  it('domínio da lista `domains`', () => {
    expect(destinoDoLink('https://minha-loja.myshopify.com/cart', contexto)).toEqual({
      destino: 'webview',
    });
  });

  it('subdomínio de um domínio listado', () => {
    expect(destinoDoLink('https://assets.cdn.minha-loja.com.br/x.png', contexto)).toEqual({
      destino: 'webview',
    });
  });
});

describe('destinoDoLink — checkout NUNCA sai da WebView', () => {
  // Mandar o checkout para fora perde os cookies de sessão e o cliente chega
  // ao pagamento com o carrinho vazio. É o erro mais caro do arquivo.
  it('caminho /checkouts/ no domínio da loja', () => {
    expect(destinoDoLink('https://minha-loja.com.br/checkouts/abc123', contexto)).toEqual({
      destino: 'webview',
    });
  });

  it('caminho /checkout', () => {
    expect(destinoDoLink('/checkout', contexto)).toEqual({ destino: 'webview' });
  });

  it('host de checkout da Shopify, mesmo fora da lista de domínios', () => {
    for (const url of [
      'https://checkout.shopify.com/c/abc',
      'https://shop.app/checkout/xyz',
      'https://x.shopifycs.com/frame',
    ]) {
      expect(destinoDoLink(url, contexto), url).toEqual({ destino: 'webview' });
    }
  });

  it('checkout em domínio totalmente alheio continua na WebView', () => {
    // A Shopify troca o host do checkout conforme a loja; o que decide é ser
    // checkout, não o domínio.
    expect(destinoDoLink('https://outra-marca.com/checkouts/abc', contexto)).toEqual({
      destino: 'webview',
    });
  });
});

describe('destinoDoLink — sai do app', () => {
  it('outro site em http(s)', () => {
    expect(destinoDoLink('https://instagram.com/minhaloja', contexto)).toEqual({
      destino: 'externo',
      url: 'https://instagram.com/minhaloja',
    });
  });

  it('domínio parecido com o da loja, mas de outro dono', () => {
    const resultado = destinoDoLink('https://minha-loja.com.br.evil.com/promo', contexto);
    expect(resultado.destino).toBe('externo');
  });

  it('esquemas que o sistema resolve melhor', () => {
    for (const url of [
      'tel:+5511999999999',
      'mailto:contato@minha-loja.com.br',
      'whatsapp://send?phone=5511999999999',
      'sms:+5511999999999',
      'intent://x#Intent;scheme=http;end',
      'market://details?id=com.app',
      'itms-apps://apps.apple.com/app/id123',
    ]) {
      expect(destinoDoLink(url, contexto), url).toEqual({ destino: 'externo', url });
    }
  });
});

describe('destinoDoLink — bloqueia', () => {
  it('esquemas de injeção', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'blob:https://minha-loja.com.br/abc',
    ]) {
      expect(destinoDoLink(url, contexto).destino, url).toBe('bloquear');
    }
  });

  it('about:blank', () => {
    expect(destinoDoLink('about:blank', contexto).destino).toBe('bloquear');
  });

  it('URL vazia ou só espaço', () => {
    expect(destinoDoLink('', contexto).destino).toBe('bloquear');
    expect(destinoDoLink('   ', contexto).destino).toBe('bloquear');
  });

  it('explica o motivo do bloqueio', () => {
    const resultado = destinoDoLink('javascript:alert(1)', contexto);
    expect(resultado.destino).toBe('bloquear');
    if (resultado.destino === 'bloquear') {
      expect(resultado.motivo).toContain('javascript:');
    }
  });
});

describe('ehCheckout', () => {
  it('reconhece os caminhos de checkout', () => {
    expect(ehCheckout(new URL('https://x.com/checkouts/abc'))).toBe(true);
    expect(ehCheckout(new URL('https://x.com/checkout'))).toBe(true);
    expect(ehCheckout(new URL('https://x.com/CHECKOUTS/abc'))).toBe(true);
  });

  it('não confunde caminho que apenas contém a palavra', () => {
    expect(ehCheckout(new URL('https://x.com/blog/como-fazer-checkout-rapido'))).toBe(false);
  });
});

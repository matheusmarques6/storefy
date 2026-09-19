import { describe, expect, it } from 'vitest';
import {
  corNormalizada,
  detectarMarca,
  nomeDoTitulo,
  pareceShopify,
  temaSugerido,
} from '@/lib/deteccao-da-loja';

const LOJA = 'https://oakvintage.com.br';

/** Cabeçalho parecido com o que um tema de Shopify entrega de verdade. */
const HTML_SHOPIFY = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Oak Vintage &ndash; Peças garimpadas dos anos 90</title>
  <meta name="description" content="Jaquetas, calças e camisas garimpadas.">
  <meta name="theme-color" content="#1A1A1A">
  <meta property="og:site_name" content="Oak Vintage">
  <meta property="og:description" content="Peças únicas, garimpadas à mão.">
  <meta property="og:image" content="//cdn.shopify.com/s/files/1/0001/capa.jpg">
  <link rel="apple-touch-icon" href="/cdn/shop/files/icone_180x.png">
  <link rel="icon" href="/favicon.ico">
  <script>var Shopify = Shopify || {}; Shopify.shop = "oak-vintage.myshopify.com";</script>
</head>
<body></body></html>`;

describe('nomeDoTitulo', () => {
  it('fica com o nome e descarta a frase do tema', () => {
    // O nome do app tem 30 caracteres na App Store; a linha inteira do título
    // não cabe, e o lojista publicaria com a frase de efeito junto.
    expect(nomeDoTitulo('Oak Vintage – Peças garimpadas dos anos 90')).toBe('Oak Vintage');
    expect(nomeDoTitulo('Oak Vintage | Loja oficial')).toBe('Oak Vintage');
    expect(nomeDoTitulo('Oak Vintage - Vintage de verdade')).toBe('Oak Vintage');
    expect(nomeDoTitulo('Oak Vintage · Brasil')).toBe('Oak Vintage');
  });

  it('não corta nome que tem hífen colado', () => {
    expect(nomeDoTitulo('Mercado-Livre')).toBe('Mercado-Livre');
    expect(nomeDoTitulo('Casa & Cia')).toBe('Casa & Cia');
  });

  it('decodifica as entidades que aparecem em título de loja', () => {
    expect(nomeDoTitulo('Casa &amp; Cia')).toBe('Casa & Cia');
    expect(nomeDoTitulo('Loja da Ma&#39;ria')).toBe("Loja da Ma'ria");
  });

  it('devolve null quando não há título', () => {
    expect(nomeDoTitulo('')).toBeNull();
    expect(nomeDoTitulo('   ')).toBeNull();
    expect(nomeDoTitulo(' | ')).toBeNull();
    expect(nomeDoTitulo('---')).toBeNull();
    expect(nomeDoTitulo('•')).toBeNull();
  });

  it('corta nome absurdamente longo em vez de aceitar tudo', () => {
    const nome = nomeDoTitulo('a'.repeat(200));
    expect(nome?.length).toBe(60);
  });
});

describe('corNormalizada', () => {
  it('aceita hexadecimal em qualquer caixa', () => {
    expect(corNormalizada('#1A1A1A')).toBe('#1a1a1a');
    expect(corNormalizada('  #abc ')).toBe('#abc');
  });

  it('joga fora o canal alfa, que o tema do app não usa', () => {
    expect(corNormalizada('#1a1a1aff')).toBe('#1a1a1a');
  });

  it('converte rgb e rgba', () => {
    expect(corNormalizada('rgb(26, 26, 26)')).toBe('#1a1a1a');
    expect(corNormalizada('rgba(255, 0, 0, 0.5)')).toBe('#ff0000');
    expect(corNormalizada('rgb(0 0 0)')).toBe('#000000');
  });

  it('devolve null em vez de inventar', () => {
    // Um chute aqui vira a cor da marca de alguém, publicada num app.
    for (const valor of [null, '', '   ', 'azul', 'var(--cor)', 'rgb(300,0,0)', '#12345', '#zzz']) {
      expect(corNormalizada(valor), String(valor)).toBeNull();
    }
  });
});

describe('pareceShopify', () => {
  it('reconhece as marcas que a plataforma deixa', () => {
    expect(pareceShopify(HTML_SHOPIFY)).toBe(true);
    expect(pareceShopify('<img src="https://cdn.shopify.com/x.png">')).toBe(true);
    expect(pareceShopify('<img src="/cdn/shop/files/y.png">')).toBe(true);
    expect(pareceShopify('<meta name="shopify-features" content="{}">')).toBe(true);
  });

  it('não confunde outra plataforma com Shopify', () => {
    expect(pareceShopify('<html><head><title>Loja em WooCommerce</title></head></html>')).toBe(
      false,
    );
    expect(pareceShopify('')).toBe(false);
  });
});

describe('detectarMarca', () => {
  it('lê tudo que a página conta', () => {
    expect(detectarMarca(HTML_SHOPIFY, LOJA)).toEqual({
      nome: 'Oak Vintage',
      corPrincipal: '#1a1a1a',
      logo: 'https://oakvintage.com.br/cdn/shop/files/icone_180x.png',
      descricao: 'Peças únicas, garimpadas à mão.',
      ehShopify: true,
    });
  });

  it('resolve endereço relativo e protocolo-relativo contra a loja', () => {
    const html = `<head><link rel="apple-touch-icon" href="//cdn.shopify.com/icone.png"></head>`;
    expect(detectarMarca(html, LOJA).logo).toBe('https://cdn.shopify.com/icone.png');
  });

  it('cai no título quando não há og:site_name', () => {
    const html = '<head><title>Oak Vintage | Novidades</title></head>';
    expect(detectarMarca(html, LOJA).nome).toBe('Oak Vintage');
  });

  it('lê metatag com os atributos na ordem invertida', () => {
    // Tema de loja escreve das duas formas; uma regex só pegaria metade.
    const html = '<head><meta content="#ff0000" name="theme-color"></head>';
    expect(detectarMarca(html, LOJA).corPrincipal).toBe('#ff0000');
  });

  it('DEVOLVE VAZIO em vez de chutar a partir do domínio', () => {
    // Um "nome provável" apareceria como certeza, e o lojista publicaria o app
    // com ele sem perceber.
    expect(detectarMarca('<html><body>oi</body></html>', LOJA)).toEqual({
      nome: null,
      corPrincipal: null,
      logo: null,
      descricao: null,
      ehShopify: false,
    });
  });

  it('não estoura com HTML quebrado, que é o normal em tema de loja', () => {
    for (const html of ['', '<html', '<<<>>>', '<head><meta name=theme-color content=#fff>']) {
      expect(() => detectarMarca(html, LOJA)).not.toThrow();
    }
  });

  it('ignora logo com esquema que não dá para baixar', () => {
    const html = '<head><link rel="apple-touch-icon" href="javascript:alert(1)"></head>';
    expect(detectarMarca(html, LOJA).logo).toBeNull();
  });
});

describe('temaSugerido', () => {
  it('leva a cor da marca só para onde ela funciona', () => {
    // Pintar o fundo com a cor da marca costuma dar tela ilegível, e é
    // escolha que só o lojista faz olhando.
    expect(temaSugerido('#1a1a1a')).toEqual({ primary: '#1a1a1a', tabBarActive: '#1a1a1a' });
  });

  it('não sugere nada quando não há cor', () => {
    expect(temaSugerido(null)).toBeNull();
    expect(temaSugerido('azul')).toBeNull();
  });
});

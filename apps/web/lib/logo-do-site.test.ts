import { describe, expect, it, vi } from 'vitest';
import { analisarIcone, problemasDoIcone } from '@storefy/assets';
import { candidatosDeLogo, iconeDoSite, urlOriginalDaShopify } from '@/lib/logo-do-site';
import { logoTransparente } from '@/test/png';

const BASE = 'https://oakvintage.com.br/';

describe('urlOriginalDaShopify', () => {
  it('tira o tamanho pedido pelo tema e fica com o arquivo original', () => {
    expect(
      urlOriginalDaShopify(
        'https://oakvintage.com.br/cdn/shop/files/logo.png?v=1712&width=180&height=60&crop=center',
      ),
    ).toBe('https://oakvintage.com.br/cdn/shop/files/logo.png?v=1712');
    expect(
      urlOriginalDaShopify('https://cdn.shopify.com/s/files/1/0001/files/logo_180x.png?v=3'),
    ).toBe('https://cdn.shopify.com/s/files/1/0001/files/logo.png?v=3');
    expect(
      urlOriginalDaShopify('https://cdn.shopify.com/s/files/1/0001/files/icone_32x32@2x.png'),
    ).toBe('https://cdn.shopify.com/s/files/1/0001/files/icone.png');
  });

  it('imagem de fora do CDN da Shopify fica como está', () => {
    const outra = 'https://imagens.exemplo.com/logo.png?width=180';
    expect(urlOriginalDaShopify(outra)).toBe(outra);
    expect(urlOriginalDaShopify('não é url')).toBe('não é url');
  });
});

describe('candidatosDeLogo', () => {
  it('o logo do cabeçalho vem primeiro, na maior versão do srcset', () => {
    const html = `
      <meta property="og:image" content="https://oakvintage.com.br/cdn/shop/files/banner.jpg?width=1200">
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
      <link rel="icon" type="image/png" href="//oakvintage.com.br/cdn/shop/files/favicon.png?crop=center&amp;height=32&amp;v=1&amp;width=32">
      <img src="//oakvintage.com.br/cdn/shop/files/logo.png?v=9&amp;width=300"
           srcset="//oakvintage.com.br/cdn/shop/files/logo.png?v=9&amp;width=300 300w, //oakvintage.com.br/cdn/shop/files/logo.png?v=9&amp;width=600 600w"
           class="header__heading-logo motion-reduce" alt="Oak Vintage">
      <img src="/produto.jpg" class="card__media">`;

    expect(candidatosDeLogo(html, BASE)).toEqual([
      'https://oakvintage.com.br/cdn/shop/files/logo.png?v=9',
      'https://oakvintage.com.br/apple-touch-icon.png',
      'https://oakvintage.com.br/cdn/shop/files/favicon.png?v=1',
      'https://oakvintage.com.br/cdn/shop/files/banner.jpg',
    ]);
  });

  it('og:logo vem antes do ícone; o que se repete aparece uma vez só', () => {
    const html = `
      <link rel="icon" href="/logo.png">
      <meta property="og:logo" content="/logo.png">
      <meta name="og:logo" content="/logo.png">`;
    expect(candidatosDeLogo(html, BASE)).toEqual(['https://oakvintage.com.br/logo.png']);
  });

  it('página sem nada disso não tem candidato', () => {
    expect(candidatosDeLogo('<html><body>oi</body></html>', BASE)).toEqual([]);
  });
});

/** Um logo azul, transparente, do tamanho pedido. */
function logo(largura: number, altura: number): Blob {
  return new Blob([new Uint8Array(logoTransparente(largura, altura))], { type: 'image/png' });
}

/** Um fetch que responde por endereço, como o site e o CDN responderiam. */
function redeFalsa(rotas: Record<string, { tipo: string; corpo: Blob | string }>) {
  const visitados: string[] = [];
  const buscador = vi.fn((url: string | URL | Request) => {
    const endereco = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    visitados.push(endereco);
    const rota = rotas[endereco];
    if (rota === undefined) return Promise.resolve(new Response('não achei', { status: 404 }));
    return Promise.resolve(
      new Response(rota.corpo, { status: 200, headers: { 'content-type': rota.tipo } }),
    );
  });
  return { buscador: buscador as unknown as typeof fetch, visitados };
}

describe('iconeDoSite', () => {
  it('pula o logo que não baixa e o pequeno, e faz o ícone do que serve', async () => {
    const { buscador, visitados } = redeFalsa({
      [BASE]: {
        tipo: 'text/html',
        corpo: `<link rel="apple-touch-icon" href="/touch.png">
                <meta property="og:logo" content="/sumiu.png">
                <img class="header__logo" src="/cdn/shop/files/logo.png?width=200">`,
      },
      'https://oakvintage.com.br/cdn/shop/files/logo.png': {
        tipo: 'image/png',
        corpo: logo(900, 300),
      },
      'https://oakvintage.com.br/touch.png': { tipo: 'image/png', corpo: logo(140, 140) },
    });

    const resultado = await iconeDoSite(new URL(BASE), '#0f3d2e', buscador);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    // Passa na MESMA régua do ícone enviado à mão.
    expect(problemasDoIcone(await analisarIcone(resultado.icone))).toEqual([]);
    // O logo do cabeçalho, no tamanho original, foi o primeiro tentado.
    expect(visitados[1]).toBe('https://oakvintage.com.br/cdn/shop/files/logo.png');
  });

  it('só logo pequeno: a mensagem diz para enviar o ícone de 1024', async () => {
    const { buscador } = redeFalsa({
      [BASE]: { tipo: 'text/html', corpo: '<link rel="apple-touch-icon" href="/touch.png">' },
      'https://oakvintage.com.br/touch.png': { tipo: 'image/png', corpo: logo(140, 140) },
    });

    expect(await iconeDoSite(new URL(BASE), null, buscador)).toEqual({
      ok: false,
      motivo:
        'O logo do site é pequeno demais para virar um ícone nítido. Envie um ícone de 1024×1024.',
    });
  });

  it('página sem logo, ou fora do ar, diz o que aconteceu', async () => {
    const semLogo = redeFalsa({ [BASE]: { tipo: 'text/html', corpo: '<p>oi</p>' } });
    expect(await iconeDoSite(new URL(BASE), null, semLogo.buscador)).toEqual({
      ok: false,
      motivo: 'Não achamos um logo na página inicial da loja. Envie o ícone à mão.',
    });

    const foraDoAr = redeFalsa({});
    const resultado = await iconeDoSite(new URL(BASE), null, foraDoAr.buscador);
    expect(resultado).toEqual({
      ok: false,
      motivo: 'A loja respondeu com erro 404. Confira o endereço.',
    });
  });

  /* O logo é buscado pela mesma busca pública: endereço interno nem sai. */
  it('logo apontando para endereço interno não é buscado', async () => {
    const { buscador, visitados } = redeFalsa({
      [BASE]: {
        tipo: 'text/html',
        corpo: '<meta property="og:logo" content="http://169.254.169.254/logo.png">',
      },
    });

    const resultado = await iconeDoSite(new URL(BASE), null, buscador);
    expect(resultado.ok).toBe(false);
    expect(visitados).toEqual([BASE]);
  });
});

import { describe, expect, it } from 'vitest';
import { parseAppConfig, type AppConfigInput } from '@storefy/config-schema';
import { avisoDoTopo, avisoFoiFechado } from './aviso';

function config(announcement?: AppConfigInput['announcement']) {
  return parseAppConfig({
    version: 1,
    store: {
      name: 'Oak Vintage',
      url: 'https://oakvintage.com.br',
      domains: ['oakvintage.com.br', 'oak-vintage.myshopify.com'],
    },
    theme: {
      primary: '#1a1a1a',
      background: '#ffffff',
      text: '#1a1a1a',
      tabBarBg: '#ffffff',
      tabBarActive: '#1a1a1a',
      tabBarInactive: '#9ca3af',
      statusBar: 'dark',
    },
    tabs: [
      { id: 'inicio', label: 'Início', icon: 'house', type: 'webview', url: '/' },
      { id: 'carrinho', label: 'Carrinho', icon: 'shopping-bag', type: 'cart' },
    ],
    webview: { hideSelectors: [] },
    features: {
      pushPromptTiming: 'onboarding',
      onboardingSlides: [],
      appBanner: { enabled: false, text: '' },
    },
    announcement,
  });
}

describe('avisoDoTopo', () => {
  it('config antiga, sem o campo, não mostra aviso', () => {
    expect(avisoDoTopo(config())).toBeNull();
  });

  it('desligado ou sem texto não mostra nada', () => {
    expect(avisoDoTopo(config({ enabled: false, text: 'Frete grátis' }))).toBeNull();
    expect(avisoDoTopo(config({ enabled: true, text: '   ' }))).toBeNull();
  });

  it('ligado com texto, sem link: só texto, sem espaço sobrando', () => {
    expect(avisoDoTopo(config({ enabled: true, text: '  Frete grátis acima de R$ 199 ' }))).toEqual(
      { texto: 'Frete grátis acima de R$ 199', caminho: null },
    );
  });

  it('o link da loja vira o caminho que o toque abre, com busca e âncora', () => {
    expect(
      avisoDoTopo(
        config({ enabled: true, text: 'Promoção', url: '/collections/promo?ordem=preco' }),
      )?.caminho,
    ).toBe('/collections/promo?ordem=preco');
    expect(
      avisoDoTopo(
        config({
          enabled: true,
          text: 'Promoção',
          url: 'https://oakvintage.com.br/pages/frete#prazo',
        }),
      )?.caminho,
    ).toBe('/pages/frete#prazo');
    expect(
      avisoDoTopo(
        config({ enabled: true, text: 'Promoção', url: 'https://oak-vintage.myshopify.com/cart' }),
      )?.caminho,
    ).toBe('/cart');
  });

  it('link de fora da loja não abre dentro do app: o aviso fica só de texto', () => {
    const aviso = avisoDoTopo(
      config({ enabled: true, text: 'Siga a loja', url: 'https://outro-site.com/login' }),
    );
    expect(aviso).toEqual({ texto: 'Siga a loja', caminho: null });
    expect(
      avisoDoTopo(config({ enabled: true, text: 'Aviso', url: 'javascript:alert(1)' }))?.caminho,
    ).toBeNull();
  });
});

describe('avisoFoiFechado', () => {
  const aviso = { texto: 'Frete grátis', caminho: null };

  it('fechado com o mesmo texto continua fechado', () => {
    expect(avisoFoiFechado(aviso, 'Frete grátis')).toBe(true);
  });

  it('texto novo é aviso novo, e nunca ter fechado é mostrar', () => {
    expect(avisoFoiFechado(aviso, 'Frete grátis no Sul')).toBe(false);
    expect(avisoFoiFechado(aviso, null)).toBe(false);
  });
});

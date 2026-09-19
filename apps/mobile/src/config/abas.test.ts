import { describe, expect, it } from 'vitest';
import { parseAppConfig, type AppConfigInput } from '@storefy/config-schema';
import { abaDoCarrinho, abaParaCaminho, abasUsaveis, resolverAbas, urlDaAba } from './abas';

function config(tabs: AppConfigInput['tabs']) {
  return parseAppConfig({
    version: 1,
    store: {
      name: 'Oak Vintage',
      url: 'https://oakvintage.com.br',
      domains: ['oakvintage.com.br'],
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
    tabs,
    webview: { hideSelectors: [] },
    features: {
      pushPromptTiming: 'onboarding',
      onboardingSlides: [],
      appBanner: { enabled: false, text: '' },
    },
  });
}

const QUATRO_ABAS: AppConfigInput['tabs'] = [
  { id: 'home', label: 'Início', icon: 'house', type: 'webview', url: '/' },
  { id: 'busca', label: 'Buscar', icon: 'search', type: 'search' },
  { id: 'carrinho', label: 'Carrinho', icon: 'bag', type: 'cart', badge: 'cart_count' },
  { id: 'conta', label: 'Conta', icon: 'user', type: 'account' },
];

describe('urlDaAba', () => {
  const base = 'https://oakvintage.com.br';

  it('usa o caminho padrão de cada tipo', () => {
    expect(urlDaAba({ id: 'c', label: 'C', icon: 'x', type: 'cart', badge: 'none' }, base)).toBe(
      'https://oakvintage.com.br/cart',
    );
    expect(urlDaAba({ id: 'a', label: 'A', icon: 'x', type: 'account', badge: 'none' }, base)).toBe(
      'https://oakvintage.com.br/account',
    );
    expect(urlDaAba({ id: 's', label: 'S', icon: 'x', type: 'search', badge: 'none' }, base)).toBe(
      'https://oakvintage.com.br/search',
    );
  });

  it('respeita o caminho escolhido pelo lojista', () => {
    const aba = {
      id: 'p',
      label: 'P',
      icon: 'x',
      type: 'webview' as const,
      url: '/colecoes/promo',
      badge: 'none' as const,
    };
    expect(urlDaAba(aba, base)).toBe('https://oakvintage.com.br/colecoes/promo');
  });

  it('devolve null para a aba nativa de notificações', () => {
    const aba = {
      id: 'n',
      label: 'N',
      icon: 'x',
      type: 'notifications' as const,
      badge: 'unread' as const,
    };
    expect(urlDaAba(aba, base)).toBeNull();
  });

  it('RECUSA caminho absoluto apontando para fora da loja', () => {
    // Viraria uma aba que abre outro site dentro do app, e o roteador de links
    // não é consultado na carga inicial de cada aba.
    const aba = {
      id: 'x',
      label: 'X',
      icon: 'x',
      type: 'webview' as const,
      url: 'https://outro-site.com/',
      badge: 'none' as const,
    };
    expect(urlDaAba(aba, base)).toBeNull();
  });

  it('recusa esquema que não é http(s)', () => {
    const aba = {
      id: 'x',
      label: 'X',
      icon: 'x',
      type: 'webview' as const,
      url: 'javascript:alert(1)',
      badge: 'none' as const,
    };
    expect(urlDaAba(aba, base)).toBeNull();
  });
});

describe('resolverAbas', () => {
  it('resolve as quatro abas da loja', () => {
    const abas = resolverAbas(config(QUATRO_ABAS));
    expect(abas).toHaveLength(4);
    expect(abas.map((a) => a.id)).toEqual(['home', 'busca', 'carrinho', 'conta']);
  });

  it('marca quais abas precisam de WebView própria', () => {
    const abas = resolverAbas(
      config([
        ...QUATRO_ABAS.slice(0, 2),
        { id: 'avisos', label: 'Avisos', icon: 'bell', type: 'notifications', badge: 'unread' },
      ]),
    );
    expect(abas.filter((a) => a.webview).map((a) => a.id)).toEqual(['home', 'busca']);
    expect(abas.find((a) => a.id === 'avisos')?.webview).toBe(false);
  });

  it('preserva rótulo, ícone e badge', () => {
    const carrinho = resolverAbas(config(QUATRO_ABAS)).find((a) => a.id === 'carrinho');
    expect(carrinho).toMatchObject({ label: 'Carrinho', icone: 'bag', badge: 'cart_count' });
  });
});

describe('abaDoCarrinho', () => {
  it('encontra a aba que mostra a quantidade', () => {
    expect(abaDoCarrinho(resolverAbas(config(QUATRO_ABAS)))?.id).toBe('carrinho');
  });

  it('devolve null quando nenhuma aba mostra badge de carrinho', () => {
    const semBadge = QUATRO_ABAS.map((a) => ({ ...a, badge: 'none' as const }));
    expect(abaDoCarrinho(resolverAbas(config(semBadge)))).toBeNull();
  });
});

describe('abaParaCaminho — destino do deep link de push', () => {
  const abas = resolverAbas(config(QUATRO_ABAS));

  it('leva o caminho de conta para a aba de conta', () => {
    // A aba mais específica vence: /account/orders não deve abrir na inicial.
    expect(abaParaCaminho(abas, '/account/orders')?.aba.id).toBe('conta');
  });

  it('leva o carrinho para a aba de carrinho', () => {
    expect(abaParaCaminho(abas, '/cart')?.aba.id).toBe('carrinho');
  });

  it('cai na primeira aba quando nada corresponde', () => {
    // Melhor abrir o produto na aba errada do que não abrir.
    expect(abaParaCaminho(abas, '/products/camiseta')?.aba.id).toBe('home');
  });

  it('normaliza caminho sem barra inicial', () => {
    expect(abaParaCaminho(abas, 'products/x')?.caminho).toBe('/products/x');
  });

  it('devolve null sem nenhuma aba', () => {
    expect(abaParaCaminho([], '/x')).toBeNull();
  });
});

describe('abasUsaveis', () => {
  const COM_AVISOS: AppConfigInput['tabs'] = [
    { id: 'home', label: 'Início', icon: 'house', type: 'webview', url: '/' },
    { id: 'avisos', label: 'Avisos', icon: 'bell', type: 'notifications', badge: 'unread' },
    { id: 'conta', label: 'Conta', icon: 'user', type: 'account' },
  ];

  it('esconde a caixa de avisos num build sem push', () => {
    // Sem OneSignal ela abriria em nada, e tela "em breve" é proibida.
    const abas = resolverAbas(config(COM_AVISOS));
    expect(abasUsaveis(abas, { push: false }).map((aba) => aba.id)).toEqual(['home', 'conta']);
  });

  it('mostra a caixa de avisos quando o push está configurado', () => {
    const abas = resolverAbas(config(COM_AVISOS));
    expect(abasUsaveis(abas, { push: true }).map((aba) => aba.id)).toEqual([
      'home',
      'avisos',
      'conta',
    ]);
  });

  it('não mexe em abas que já são de WebView', () => {
    const abas = resolverAbas(config(QUATRO_ABAS));
    expect(abasUsaveis(abas, { push: false })).toEqual(abas);
  });

  it('devolve a lista original em vez de uma barra vazia', () => {
    const soAvisos: AppConfigInput['tabs'] = [
      { id: 'a1', label: 'Avisos', icon: 'bell', type: 'notifications', badge: 'unread' },
      { id: 'a2', label: 'Outros', icon: 'bell', type: 'notifications', badge: 'unread' },
    ];
    const abas = resolverAbas(config(soAvisos));
    expect(abasUsaveis(abas, { push: false })).toHaveLength(2);
  });
});

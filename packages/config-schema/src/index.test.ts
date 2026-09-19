/**
 * Testes do contrato AppConfig.
 *
 * A config de exemplo vive SOMENTE aqui: a regra 1 do CLAUDE.md proíbe dado
 * fictício no produto, e a exceção vale apenas para testes automatizados.
 */
import { describe, expect, it } from 'vitest';
import { AppConfigSchema, parseAppConfig, safeParseAppConfig } from './index';
import type { AppConfigInput } from './index';

/** Config mínima e válida: só os campos obrigatórios, sem nenhum default. */
function configMinima(): AppConfigInput {
  return {
    version: 1,
    store: {
      name: 'Loja de Teste',
      url: 'https://loja-de-teste.com.br',
      domains: ['loja-de-teste.com.br'],
    },
    theme: {
      primary: '#111827',
      background: '#ffffff',
      text: '#111827',
      tabBarBg: '#ffffff',
      tabBarActive: '#111827',
      tabBarInactive: '#9ca3af',
      statusBar: 'dark',
    },
    tabs: [
      { id: 'home', label: 'Início', icon: 'house', type: 'webview', url: '/' },
      { id: 'cart', label: 'Carrinho', icon: 'shopping-cart', type: 'cart' },
    ],
    webview: { hideSelectors: ['header', '.site-footer'] },
    features: {
      pushPromptTiming: 'onboarding',
      onboardingSlides: [],
      appBanner: { enabled: false, text: '' },
    },
  };
}

describe('AppConfig — config válida', () => {
  it('aceita a config mínima', () => {
    expect(() => parseAppConfig(configMinima())).not.toThrow();
  });

  it('aceita a config completa, com os campos opcionais preenchidos', () => {
    const completa: AppConfigInput = {
      ...configMinima(),
      tabs: [
        { id: 'home', label: 'Início', icon: 'house', type: 'webview', url: '/', badge: 'none' },
        {
          id: 'busca',
          label: 'Buscar',
          icon: 'search',
          type: 'search',
          badge: 'none',
        },
        {
          id: 'cart',
          label: 'Carrinho',
          icon: 'shopping-cart',
          type: 'cart',
          badge: 'cart_count',
        },
        {
          id: 'avisos',
          label: 'Avisos',
          icon: 'bell',
          type: 'notifications',
          badge: 'unread',
        },
        { id: 'conta', label: 'Conta', icon: 'user', type: 'account', badge: 'none' },
      ],
      webview: {
        hideSelectors: ['header', '.site-footer', '#shopify-chat'],
        customCss: 'body { padding-top: 0; }',
        customJs: 'console.info("storefy");',
        pullToRefresh: false,
        userAgentSuffix: 'StorefyApp/2',
      },
      features: {
        pushPromptTiming: 'after_first_add_to_cart',
        onboardingSlides: [
          { title: 'Bem-vindo', body: 'Sua loja agora é um app.', image: 'slide-1.png' },
        ],
        appBanner: { enabled: true, text: 'Baixe nosso app' },
        biometricLogin: true,
        rateAppPrompt: false,
      },
      announcement: { enabled: true, text: 'Frete grátis hoje', url: '/promocoes' },
      minSupportedBuild: 12,
    };

    const resultado = parseAppConfig(completa);
    expect(resultado.tabs).toHaveLength(5);
    expect(resultado.announcement?.text).toBe('Frete grátis hoje');
    expect(resultado.minSupportedBuild).toBe(12);
  });

  it('aceita de 2 a 5 abas, os limites da tab bar', () => {
    const duas = configMinima();
    expect(safeParseAppConfig(duas).success).toBe(true);

    const cinco: AppConfigInput = {
      ...configMinima(),
      tabs: Array.from({ length: 5 }, (_, i) => ({
        id: `aba-${String(i)}`,
        label: `Aba ${String(i)}`,
        icon: 'house',
        type: 'webview' as const,
        url: '/',
      })),
    };
    expect(safeParseAppConfig(cinco).success).toBe(true);
  });
});

describe('AppConfig — defaults dos campos opcionais', () => {
  it('preenche os defaults de webview quando eles são omitidos', () => {
    const { webview } = parseAppConfig(configMinima());
    expect(webview.customCss).toBe('');
    expect(webview.customJs).toBe('');
    expect(webview.pullToRefresh).toBe(true);
    expect(webview.userAgentSuffix).toBe('StorefyApp');
  });

  it('preenche os defaults de features quando eles são omitidos', () => {
    const { features } = parseAppConfig(configMinima());
    expect(features.biometricLogin).toBe(false);
    expect(features.rateAppPrompt).toBe(true);
  });

  it('usa minSupportedBuild = 1 quando ele é omitido', () => {
    expect(parseAppConfig(configMinima()).minSupportedBuild).toBe(1);
  });

  it('usa badge = "none" em cada aba que não define badge', () => {
    const { tabs } = parseAppConfig(configMinima());
    expect(tabs.every((aba) => aba.badge === 'none')).toBe(true);
  });

  it('deixa announcement indefinido quando ele é omitido', () => {
    expect(parseAppConfig(configMinima()).announcement).toBeUndefined();
  });

  it('não sobrescreve um valor explícito com o default', () => {
    const config = configMinima();
    config.webview.pullToRefresh = false;
    config.webview.userAgentSuffix = 'Outro';
    const { webview } = parseAppConfig(config);
    expect(webview.pullToRefresh).toBe(false);
    expect(webview.userAgentSuffix).toBe('Outro');
  });
});

describe('AppConfig — config inválida', () => {
  it('recusa uma URL de loja que não é URL', () => {
    const config = configMinima();
    config.store.url = 'loja-de-teste.com.br';
    const resultado = safeParseAppConfig(config);
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(['store', 'url']);
  });

  it('recusa menos de 2 abas', () => {
    const config = configMinima();
    config.tabs = [{ id: 'home', label: 'Início', icon: 'house', type: 'webview', url: '/' }];
    expect(safeParseAppConfig(config).success).toBe(false);
  });

  it('recusa mais de 5 abas', () => {
    const config = configMinima();
    config.tabs = Array.from({ length: 6 }, (_, i) => ({
      id: `aba-${String(i)}`,
      label: 'Aba',
      icon: 'house',
      type: 'webview' as const,
    }));
    expect(safeParseAppConfig(config).success).toBe(false);
  });

  it('recusa um rótulo de aba com mais de 12 caracteres', () => {
    const config = configMinima();
    config.tabs[0] = {
      id: 'home',
      label: 'Rótulo muito comprido',
      icon: 'house',
      type: 'webview',
    };
    expect(safeParseAppConfig(config).success).toBe(false);
  });

  it('recusa um tipo de aba desconhecido', () => {
    const config: unknown = {
      ...configMinima(),
      tabs: [
        { id: 'a', label: 'A', icon: 'house', type: 'carrossel' },
        { id: 'b', label: 'B', icon: 'house', type: 'cart' },
      ],
    };
    expect(safeParseAppConfig(config).success).toBe(false);
  });

  it('recusa mais de 4 slides de onboarding', () => {
    const config = configMinima();
    config.features.onboardingSlides = Array.from({ length: 5 }, (_, i) => ({
      title: `Slide ${String(i)}`,
      body: 'Texto',
      image: 'slide.png',
    }));
    expect(safeParseAppConfig(config).success).toBe(false);
  });

  it('recusa um statusBar fora de light/dark', () => {
    const base = configMinima();
    const config: unknown = { ...base, theme: { ...base.theme, statusBar: 'auto' } };
    expect(safeParseAppConfig(config).success).toBe(false);
  });

  it('recusa quando um bloco obrigatório falta', () => {
    const { theme: _theme, ...semTheme } = configMinima();
    expect(safeParseAppConfig(semTheme).success).toBe(false);
  });

  it('recusa version em formato errado', () => {
    const config = { ...configMinima(), version: 'primeira' };
    expect(safeParseAppConfig(config).success).toBe(false);
  });

  it('recusa entrada que não é objeto', () => {
    expect(safeParseAppConfig(null).success).toBe(false);
    expect(safeParseAppConfig('config').success).toBe(false);
    expect(safeParseAppConfig([]).success).toBe(false);
  });

  it('parseAppConfig lança ZodError em config inválida', () => {
    expect(() => parseAppConfig({})).toThrow();
  });
});

describe('AppConfig — compatibilidade retroativa', () => {
  it('uma config gravada só com campos obrigatórios continua válida', () => {
    // Simula uma config publicada por uma versão anterior do painel: se este
    // teste quebrar, apps já publicados param de abrir. Ver seção 3 do plano.
    const publicadaAntes = configMinima();
    expect(safeParseAppConfig(publicadaAntes).success).toBe(true);
  });

  it('todo campo com default permanece opcional na entrada', () => {
    // Garante que nenhum campo novo entrou como obrigatório sem querer.
    const forma = AppConfigSchema.shape;
    expect(forma.minSupportedBuild.safeParse(undefined).success).toBe(true);
    expect(forma.announcement.safeParse(undefined).success).toBe(true);
  });
});

describe('apertos que o editor do painel depende', () => {
  it('recusa cor que não é hexadecimal', () => {
    // `primary: 'azul'` renderizaria com a cor padrão da plataforma e ninguém
    // entenderia por quê.
    for (const cor of ['azul', 'rgb(0,0,0)', '#12345', '#gggggg', '', '111827']) {
      const analise = safeParseAppConfig(configComTema({ primary: cor }));
      expect(analise.success, cor).toBe(false);
    }
  });

  it('aceita as três formas de hexadecimal que o React Native entende', () => {
    for (const cor of ['#000', '#1a1a1a', '#1a1a1aff', '#ABC']) {
      expect(safeParseAppConfig(configComTema({ primary: cor })).success, cor).toBe(true);
    }
  });

  it('recusa duas abas com o mesmo identificador', () => {
    // Id repetido faz duas abas disputarem a mesma WebView, e a rolagem de uma
    // aparece na outra.
    const analise = safeParseAppConfig(
      configComAbas([
        { id: 'inicio', label: 'Início', icon: 'house', type: 'webview', url: '/' },
        { id: 'inicio', label: 'Conta', icon: 'user', type: 'account' },
      ]),
    );
    expect(analise.success).toBe(false);
  });

  it('recusa identificador de aba que não serve em deep link', () => {
    for (const id of ['', 'Início', 'aba com espaço', '-comeca-com-hifen', 'ABA']) {
      const analise = safeParseAppConfig(
        configComAbas([
          { id, label: 'A', icon: 'house', type: 'webview', url: '/' },
          { id: 'conta', label: 'Conta', icon: 'user', type: 'account' },
        ]),
      );
      expect(analise.success, id).toBe(false);
    }
  });

  it('recusa rótulo vazio, que deixaria a aba sem nome na barra', () => {
    const analise = safeParseAppConfig(
      configComAbas([
        { id: 'inicio', label: '', icon: 'house', type: 'webview', url: '/' },
        { id: 'conta', label: 'Conta', icon: 'user', type: 'account' },
      ]),
    );
    expect(analise.success).toBe(false);
  });
});

function configBase() {
  return {
    version: 1,
    store: { name: 'Loja', url: 'https://loja.com.br', domains: ['loja.com.br'] },
    theme: {
      primary: '#111827',
      background: '#ffffff',
      text: '#111827',
      tabBarBg: '#ffffff',
      tabBarActive: '#111827',
      tabBarInactive: '#9ca3af',
      statusBar: 'dark',
    },
    tabs: [
      { id: 'inicio', label: 'Início', icon: 'house', type: 'webview', url: '/' },
      { id: 'conta', label: 'Conta', icon: 'user', type: 'account' },
    ],
    webview: { hideSelectors: [] },
    features: {
      pushPromptTiming: 'onboarding',
      onboardingSlides: [],
      appBanner: { enabled: false, text: '' },
    },
  };
}

function configComTema(parcial: Record<string, string>) {
  const base = configBase();
  return { ...base, theme: { ...base.theme, ...parcial } };
}

function configComAbas(abas: unknown[]) {
  return { ...configBase(), tabs: abas };
}

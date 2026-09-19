import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { parseAppConfig, type AppConfigInput } from '@storefy/config-schema';
import { MARCA_DE_INJECAO } from './carrinho';
import {
  observaCarrinho,
  scriptAntesDoConteudo,
  scriptDepoisDoConteudo,
  scriptDoLojista,
  type ContextoDoApp,
} from './scripts';

const CONTEXTO: ContextoDoApp = { platform: 'ios', appVersion: '1.0.0', pushEnabled: false };

const ABAS_COM_CARRINHO: AppConfigInput['tabs'] = [
  { id: 'home', label: 'Início', icon: 'house', type: 'webview', url: '/' },
  { id: 'carrinho', label: 'Carrinho', icon: 'bag', type: 'cart', badge: 'cart_count' },
];

const ABAS_SEM_CARRINHO: AppConfigInput['tabs'] = [
  { id: 'home', label: 'Início', icon: 'house', type: 'webview', url: '/' },
  { id: 'conta', label: 'Conta', icon: 'user', type: 'account' },
];

function config(extra: Partial<AppConfigInput> = {}) {
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
    tabs: ABAS_COM_CARRINHO,
    webview: { hideSelectors: [] },
    features: {
      pushPromptTiming: 'onboarding',
      onboardingSlides: [],
      appBanner: { enabled: false, text: '' },
    },
    ...extra,
  });
}

function compila(codigo: string): void {
  new Script(codigo);
}

describe('scriptAntesDoConteudo', () => {
  it('leva o contexto do app e os seletores escondidos', () => {
    const script = scriptAntesDoConteudo(
      config({ webview: { hideSelectors: ['header.site-header', '.footer'] } }),
      CONTEXTO,
    );
    expect(() => {
      compila(script);
    }).not.toThrow();
    expect(script).toContain('"platform":"ios"');
    expect(script).toContain('header.site-header{display:none !important;}');
    expect(script).toContain('.footer{display:none !important;}');
  });

  it('bloqueia o zoom por pinça, que é o que mais entrega o site', () => {
    expect(scriptAntesDoConteudo(config(), CONTEXTO)).toContain('user-scalable=no');
  });

  it('NÃO leva o JavaScript do lojista junto', () => {
    // Um erro de sintaxe ali derrubaria o CSS e o contexto no mesmo parse.
    const script = scriptAntesDoConteudo(
      config({ webview: { hideSelectors: [], customJs: 'window.__MARCA_DO_LOJISTA=1;' } }),
      CONTEXTO,
    );
    expect(script).not.toContain('__MARCA_DO_LOJISTA');
  });
});

describe('scriptDepoisDoConteudo', () => {
  it('instala a API da página e o observador quando há badge de carrinho', () => {
    const script = scriptDepoisDoConteudo(config({ tabs: ABAS_COM_CARRINHO }));
    expect(() => {
      compila(script);
    }).not.toThrow();
    expect(script).toContain('window.Storefy=');
    expect(script).toContain(MARCA_DE_INJECAO);
    expect(script.trimEnd().endsWith('true;')).toBe(true);
  });

  it('dispensa o observador quando nenhuma aba mostra a contagem', () => {
    // Observar custaria uma leitura de `/cart.js` em toda página para
    // alimentar um número que ninguém veria.
    const script = scriptDepoisDoConteudo(config({ tabs: ABAS_SEM_CARRINHO }));
    expect(script).toContain('window.Storefy=');
    expect(script).not.toContain(MARCA_DE_INJECAO);
    expect(() => {
      compila(script);
    }).not.toThrow();
  });

  it('observaCarrinho responde pelo badge, não pelo tipo da aba', () => {
    expect(observaCarrinho(config({ tabs: ABAS_COM_CARRINHO }))).toBe(true);
    expect(observaCarrinho(config({ tabs: ABAS_SEM_CARRINHO }))).toBe(false);

    // Aba de carrinho sem badge: a tela existe, a contagem não aparece.
    const semBadge: AppConfigInput['tabs'] = [
      { id: 'home', label: 'Início', icon: 'house', type: 'webview', url: '/' },
      { id: 'carrinho', label: 'Carrinho', icon: 'bag', type: 'cart', badge: 'none' },
    ];
    expect(observaCarrinho(config({ tabs: semBadge }))).toBe(false);
  });
});

describe('scriptDoLojista', () => {
  it('devolve null quando não há nada a injetar', () => {
    expect(scriptDoLojista(config())).toBeNull();
    expect(
      scriptDoLojista(config({ webview: { hideSelectors: [], customJs: '   \n  ' } })),
    ).toBeNull();
  });

  it('embrulha o código do lojista em try/catch próprio', () => {
    const script = scriptDoLojista(
      config({ webview: { hideSelectors: [], customJs: 'window.__MARCA_DO_LOJISTA=1;' } }),
    );
    expect(script).not.toBeNull();
    if (script === null) return;
    expect(() => {
      compila(script);
    }).not.toThrow();
    expect(script).toContain('window.__MARCA_DO_LOJISTA=1;');
    expect(script).toContain('catch');
    expect(script.trimEnd().endsWith('true;')).toBe(true);
  });

  it('comentário de linha no fim do customJs não come o fechamento', () => {
    // Sem a quebra de linha antes do `}catch`, um `// nota` no fim comentaria
    // o resto do script e o erro só apareceria na loja do cliente.
    const script = scriptDoLojista(
      config({ webview: { hideSelectors: [], customJs: 'var x=1; // conferir depois' } }),
    );
    expect(script).not.toBeNull();
    if (script === null) return;
    expect(() => {
      compila(script);
    }).not.toThrow();
  });

  it('o erro de sintaxe do lojista fica preso no script dele', () => {
    // É o motivo de existirem três injeções em vez de uma.
    const quebrado = scriptDoLojista(
      config({ webview: { hideSelectors: [], customJs: 'function(){' } }),
    );
    expect(quebrado).not.toBeNull();
    if (quebrado === null) return;
    expect(() => {
      compila(quebrado);
    }).toThrow();

    // E o nosso continua compilando.
    expect(() => {
      compila(scriptDepoisDoConteudo(config()));
    }).not.toThrow();
  });
});

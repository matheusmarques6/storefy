import { describe, expect, it } from 'vitest';
import type { AppConfigInput } from '@storefy/config-schema';
import { decidirConfig, deveGravarNoCache, urlDaConfig } from './decisao';

/** Config real mínima, como a que o painel publica. */
function config(overrides: Partial<AppConfigInput> = {}): AppConfigInput {
  return {
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
    tabs: [
      { id: 'home', label: 'Início', icon: 'house', type: 'webview', url: '/' },
      { id: 'cart', label: 'Carrinho', icon: 'shopping-cart', type: 'cart' },
    ],
    webview: { hideSelectors: [] },
    features: {
      pushPromptTiming: 'onboarding',
      onboardingSlides: [],
      appBanner: { enabled: false, text: '' },
    },
    ...overrides,
  };
}

describe('decidirConfig — ordem das fontes', () => {
  it('prefere a rede quando ela é válida', () => {
    const resultado = decidirConfig({
      rede: config({ version: 3 }),
      cache: config({ version: 2 }),
      embutida: config({ version: 1 }),
      buildAtual: 10,
    });
    expect(resultado).toMatchObject({ estado: 'pronta', origem: 'rede' });
  });

  it('cai para o cache quando a rede não respondeu', () => {
    const resultado = decidirConfig({
      cache: config({ version: 2 }),
      embutida: config({ version: 1 }),
      buildAtual: 10,
    });
    expect(resultado).toMatchObject({ estado: 'pronta', origem: 'cache' });
  });

  it('cai para a embutida na primeira abertura sem rede', () => {
    // É o cenário de quem acabou de instalar e abriu no avião. Sem este nível,
    // o app estrearia numa tela de erro.
    const resultado = decidirConfig({ embutida: config(), buildAtual: 10 });
    expect(resultado).toMatchObject({ estado: 'pronta', origem: 'embutida' });
  });

  it('descarta fonte inválida em vez de tentar corrigir', () => {
    const resultado = decidirConfig({
      rede: { version: 'três', store: null },
      cache: config({ version: 2 }),
      embutida: config(),
      buildAtual: 10,
    });
    expect(resultado).toMatchObject({ estado: 'pronta', origem: 'cache' });
  });

  it('descarta cache corrompido', () => {
    const resultado = decidirConfig({
      cache: '{"lixo":',
      embutida: config(),
      buildAtual: 10,
    });
    expect(resultado).toMatchObject({ estado: 'pronta', origem: 'embutida' });
  });

  it('avisa quando nenhuma fonte serve', () => {
    const resultado = decidirConfig({ embutida: { nada: true }, buildAtual: 10 });
    expect(resultado.estado).toBe('sem-config');
  });
});

describe('decidirConfig — atualização obrigatória', () => {
  it('exige atualizar quando o build instalado é velho demais', () => {
    const resultado = decidirConfig({
      rede: config({ minSupportedBuild: 20 }),
      embutida: config(),
      buildAtual: 12,
    });
    expect(resultado).toEqual({ estado: 'precisa-atualizar', minimo: 20, atual: 12 });
  });

  it('deixa passar quando o build é exatamente o mínimo', () => {
    const resultado = decidirConfig({
      rede: config({ minSupportedBuild: 12 }),
      embutida: config(),
      buildAtual: 12,
    });
    expect(resultado.estado).toBe('pronta');
  });

  it('usa o minSupportedBuild da config ESCOLHIDA, não de uma descartada', () => {
    // Se a resposta da rede veio quebrada e caímos para o cache, mandar
    // atualizar por um número que não conseguimos ler prenderia o usuário
    // fora do app por causa de uma falha nossa.
    const resultado = decidirConfig({
      rede: { version: 9, minSupportedBuild: 999 },
      cache: config({ minSupportedBuild: 1 }),
      embutida: config(),
      buildAtual: 5,
    });
    expect(resultado).toMatchObject({ estado: 'pronta', origem: 'cache' });
  });

  it('respeita o default de minSupportedBuild', () => {
    // Config sem o campo recebe 1, então qualquer build instalado serve.
    const resultado = decidirConfig({ embutida: config(), buildAtual: 1 });
    expect(resultado.estado).toBe('pronta');
  });
});

describe('deveGravarNoCache', () => {
  it('grava quando a rede traz versão mais nova', () => {
    expect(deveGravarNoCache(config({ version: 5 }), config({ version: 4 }))).toBe(true);
  });

  it('grava quando ainda não há cache', () => {
    expect(deveGravarNoCache(config({ version: 1 }), undefined)).toBe(true);
  });

  it('NÃO grava resposta mais antiga que o cache', () => {
    // CDN desatualizada não deve rebaixar a config que o app já tem.
    expect(deveGravarNoCache(config({ version: 3 }), config({ version: 7 }))).toBe(false);
  });

  it('grava quando a versão é igual, para refletir edições na mesma versão', () => {
    expect(deveGravarNoCache(config({ version: 4 }), config({ version: 4 }))).toBe(true);
  });

  it('NÃO grava resposta inválida', () => {
    expect(deveGravarNoCache({ quebrada: true }, config())).toBe(false);
    expect(deveGravarNoCache(null, config())).toBe(false);
  });
});

describe('urlDaConfig', () => {
  it('monta o endereço da config publicada', () => {
    expect(urlDaConfig('https://storefy.convertfy.me', 'app_123')).toBe(
      'https://storefy.convertfy.me/api/public/app-config/app_123',
    );
  });

  it('tolera barra sobrando no fim da base', () => {
    expect(urlDaConfig('https://storefy.convertfy.me///', 'app_123')).toBe(
      'https://storefy.convertfy.me/api/public/app-config/app_123',
    );
  });

  it('escapa o appId, que vem de fora do app', () => {
    expect(urlDaConfig('https://storefy.convertfy.me', '../../admin')).toBe(
      'https://storefy.convertfy.me/api/public/app-config/..%2F..%2Fadmin',
    );
  });

  it('devolve null quando a config remota não está configurada', () => {
    // Não é erro: é o build sem `appId`, que abre com a config embutida.
    expect(urlDaConfig('https://storefy.convertfy.me', null)).toBeNull();
    expect(urlDaConfig('https://storefy.convertfy.me', '   ')).toBeNull();
    expect(urlDaConfig('', 'app_123')).toBeNull();
  });

  it('recusa base que não é http(s)', () => {
    expect(urlDaConfig('javascript:alert(1)', 'app_123')).toBeNull();
    expect(urlDaConfig('file:///etc', 'app_123')).toBeNull();
    expect(urlDaConfig('nao é url', 'app_123')).toBeNull();
  });
});

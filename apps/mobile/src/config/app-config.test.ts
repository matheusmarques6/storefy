/**
 * O `app.config.ts`, avaliado com as variáveis que o workflow manda.
 *
 * Três defeitos moravam aqui sem ninguém ver, porque nenhum teste avaliava o
 * arquivo: todo binário saía como 1.0.0 (1) — a segunda publicação de qualquer
 * loja era recusada pelas lojas de aplicativos —, todo app reclamava o
 * domínio da loja de desenvolvimento nos links universais, e o runtime do OTA
 * acompanhava a versão da loja.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExpoConfig } from 'expo/config';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

async function avaliar(variaveis: Record<string, string>): Promise<ExpoConfig> {
  process.env = { ...ORIGINAL, ...variaveis };
  vi.resetModules();
  const modulo = await import('../../app.config.ts');
  return modulo.default;
}

describe('app.config.ts', () => {
  it('versão e número do binário vêm do build, nas duas plataformas', async () => {
    const config = await avaliar({ APP_VERSION: '1.0.7', IOS_BUILD: '7', ANDROID_VC: '7' });

    expect(config.version).toBe('1.0.7');
    expect(config.ios?.buildNumber).toBe('7');
    expect(config.android?.versionCode).toBe(7);
  });

  /*
   * O OTA é publicado para UM runtime. Se ele acompanhasse a versão da loja,
   * cada binário teria o seu, e a correção de emergência só chegaria ao app
   * daquele número exato.
   */
  it('o runtime do OTA é o mesmo em todo binário, qualquer que seja a versão', async () => {
    const um = await avaliar({ APP_VERSION: '1.0.3' });
    const outro = await avaliar({ APP_VERSION: '1.0.9' });

    expect(um.runtimeVersion).toBe(outro.runtimeVersion);
    expect(typeof um.runtimeVersion).toBe('string');
  });

  it('o domínio da loja vai para os links universais e para os App Links', async () => {
    const config = await avaliar({ STORE_DOMAIN: 'www.loja.com.br' });

    expect(config.ios?.associatedDomains).toEqual(['applinks:www.loja.com.br']);
    expect(JSON.stringify(config.android?.intentFilters)).toContain('"host":"www.loja.com.br"');
  });

  it('o esquema de URL e a API são os do build', async () => {
    const config = await avaliar({
      APP_SCHEME: 'storefy-8f2c1a3e',
      API_BASE: 'https://painel.exemplo.com',
    });

    expect(config.scheme).toBe('storefy-8f2c1a3e');
    expect((config.extra as { apiBase: string }).apiBase).toBe('https://painel.exemplo.com');
  });
});

/**
 * O `app.config.ts`, avaliado com as variáveis que o workflow manda.
 *
 * Três defeitos moravam aqui sem ninguém ver, porque nenhum teste avaliava o
 * arquivo: todo binário saía como 1.0.0 (1) — a segunda publicação de qualquer
 * loja era recusada pelas lojas de aplicativos —, todo app reclamava o
 * domínio da loja de desenvolvimento nos links universais, e o runtime do OTA
 * acompanhava a versão da loja.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

  /*
   * Sem a declaração, cada versão para na App Store Connect esperando o
   * lojista responder à pergunta da criptografia antes da revisão.
   */
  it('declara à Apple que só usa a criptografia isenta do sistema', async () => {
    const config = await avaliar({});
    expect(config.ios?.config?.usesNonExemptEncryption).toBe(false);
  });

  /* Sem ele, a atualização obrigatória (M11) não tem como abrir a App Store. */
  it('o número do app na App Store vai para o extra', async () => {
    const config = await avaliar({ IOS_APP_STORE_ID: '6478123456' });
    expect((config.extra as { appStoreId: string | null }).appStoreId).toBe('6478123456');
  });
});

/*
 * O build de loja nunca herda identidade de outra loja. Os padrões do
 * `app.config.ts` são do desenvolvimento local; antes eram os de uma loja de
 * verdade, e um workflow que esquecesse uma variável geraria o app com o nome,
 * o bundle ou o domínio dela.
 */
describe('build de loja', () => {
  const PASTA = join(import.meta.dirname, '../../brands/teste-identidade');

  beforeAll(() => {
    mkdirSync(PASTA, { recursive: true });
    writeFileSync(join(PASTA, 'icon.png'), '');
    writeFileSync(join(PASTA, 'splash.png'), '');
  });

  afterAll(() => {
    rmSync(PASTA, { recursive: true, force: true });
  });

  const LOJA = {
    STORE_ID: 'teste-identidade',
    APP_NAME: 'Loja Aurora',
    APP_SLUG: 'storefy-aurora',
    IOS_BUNDLE_ID: 'me.convertfy.storefy.aurora',
    ANDROID_PACKAGE: 'me.convertfy.storefy.aurora',
    STORE_DOMAIN: 'www.aurora.com.br',
  };

  it('usa a identidade que o workflow mandou', async () => {
    const config = await avaliar(LOJA);
    expect(config.name).toBe('Loja Aurora');
    expect(config.slug).toBe('storefy-aurora');
    expect(config.ios?.bundleIdentifier).toBe('me.convertfy.storefy.aurora');
    expect(config.android?.package).toBe('me.convertfy.storefy.aurora');
  });

  it('sem nome ou slug, o build para dizendo qual falta', async () => {
    await expect(avaliar({ ...LOJA, APP_NAME: '' })).rejects.toThrow('falta a variável APP_NAME');
    await expect(avaliar({ ...LOJA, APP_SLUG: '' })).rejects.toThrow('falta a variável APP_SLUG');
  });

  it('sem bundle ou package, o campo fica de fora, e nunca é o de outra loja', async () => {
    const config = await avaliar({ ...LOJA, IOS_BUNDLE_ID: '', ANDROID_PACKAGE: '' });
    expect(config.ios?.bundleIdentifier).toBeUndefined();
    expect(config.android?.package).toBeUndefined();
  });

  /*
   * A correção OTA avalia este mesmo arquivo com `STORE_ID` definido, mas o
   * runner dela não baixa ícone nem splash — são do binário, e o pacote não
   * os leva. Sem o modo de pacote, toda correção morria aqui, antes de
   * publicar, em "falta ./brands/<loja>/icon.png".
   */
  it('o pacote de correção OTA não precisa da arte da loja', async () => {
    const semArte = { ...LOJA, STORE_ID: 'loja-sem-arte-no-runner' };
    await expect(avaliar(semArte)).rejects.toThrow('icon.png');

    const config = await avaliar({ ...semArte, STOREFY_OTA: '1' });
    expect(config.name).toBe('Loja Aurora');
    expect(config.icon).toBeUndefined();
    // O resto da identidade continua obrigatório no pacote.
    await expect(avaliar({ ...semArte, STOREFY_OTA: '1', APP_SLUG: '' })).rejects.toThrow(
      'falta a variável APP_SLUG',
    );
  });

  it('sem domínio, não reclama site nenhum', async () => {
    const config = await avaliar({ ...LOJA, STORE_DOMAIN: '' });
    expect(config.ios?.associatedDomains).toEqual([]);
    expect(config.android?.intentFilters).toEqual([]);
  });
});

describe('desenvolvimento local', () => {
  it('os padrões não são de loja nenhuma', async () => {
    const config = await avaliar({
      STORE_ID: '',
      APP_NAME: '',
      APP_SLUG: '',
      IOS_BUNDLE_ID: '',
      ANDROID_PACKAGE: '',
      STORE_DOMAIN: '',
    });
    expect(config.name).toBe('Storefy Dev');
    expect(config.slug).toBe('storefy-desenvolvimento');
    expect(config.ios?.bundleIdentifier).toBe('me.convertfy.storefy.desenvolvimento');
    expect(config.ios?.associatedDomains).toEqual([]);
  });
});

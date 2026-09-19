import { describe, expect, it } from 'vitest';
import { lerAmbiente, recursosDoBuild } from './ambiente';

const COMPLETO = {
  extra: {
    storeId: 'oakvintage',
    appId: 'app_123',
    apiBase: 'https://storefy.convertfy.me',
    oneSignalAppId: 'os_abc',
  },
  plataforma: 'ios' as const,
  versao: '1.2.0',
  buildIos: '7',
  buildAndroid: 9,
};

describe('lerAmbiente', () => {
  it('lê o extra do build', () => {
    expect(lerAmbiente(COMPLETO)).toEqual({
      storeId: 'oakvintage',
      appId: 'app_123',
      apiBase: 'https://storefy.convertfy.me',
      oneSignalAppId: 'os_abc',
      buildAtual: 7,
      appVersion: '1.2.0',
    });
  });

  it('pega o build da plataforma certa', () => {
    expect(lerAmbiente({ ...COMPLETO, plataforma: 'android' }).buildAtual).toBe(9);
  });

  it('build ilegível vira 1, o mais baixo possível', () => {
    // `NaN > minSupportedBuild` é false: um build ilegível passaria por uma
    // versão bloqueada como se estivesse em dia.
    for (const bruto of [null, undefined, '', 'sete', Number.NaN, 0, -3, 1.5, {}]) {
      expect(lerAmbiente({ ...COMPLETO, buildIos: bruto }).buildAtual).toBe(1);
    }
  });

  it('abre sem extra nenhum, que é o `expo start` sem variáveis', () => {
    for (const extra of [null, undefined, {}, 'nada', 42]) {
      const ambiente = lerAmbiente({ ...COMPLETO, extra });
      expect(ambiente.storeId).toBe('');
      expect(ambiente.appId).toBeNull();
      expect(ambiente.oneSignalAppId).toBeNull();
      expect(ambiente.buildAtual).toBe(7);
    }
  });

  it('string vazia conta como ausente, não como valor', () => {
    const ambiente = lerAmbiente({
      ...COMPLETO,
      extra: { storeId: '  ', appId: '', apiBase: '', oneSignalAppId: '   ' },
    });
    expect(ambiente.appId).toBeNull();
    expect(ambiente.oneSignalAppId).toBeNull();
    expect(ambiente.apiBase).toBe('');
  });

  it('versão ausente vira 0.0.0 em vez de undefined na página', () => {
    expect(lerAmbiente({ ...COMPLETO, versao: null }).appVersion).toBe('0.0.0');
  });
});

describe('recursosDoBuild', () => {
  it('só liga o push quando existe app ID do OneSignal', () => {
    expect(recursosDoBuild(lerAmbiente(COMPLETO)).push).toBe(true);

    const semPush = lerAmbiente({
      ...COMPLETO,
      extra: { ...COMPLETO.extra, oneSignalAppId: null },
    });
    expect(recursosDoBuild(semPush).push).toBe(false);
  });

  it('eventos seguem desligados até a Fase 5', () => {
    expect(recursosDoBuild(lerAmbiente(COMPLETO)).eventos).toBe(false);
  });
});

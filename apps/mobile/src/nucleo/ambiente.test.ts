import { describe, expect, it } from 'vitest';
import { IMPLEMENTADO, lerAmbiente, recursosDoBuild } from './ambiente';

const COMPLETO = {
  extra: {
    storeId: 'oakvintage',
    appId: 'app_123',
    apiBase: 'https://storefy.convertfy.me',
    oneSignalAppId: 'os_abc',
    deviceSecret: 'segredo-deste-build',
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
      deviceSecret: 'segredo-deste-build',
      buildAtual: 7,
      appVersion: '1.2.0',
      modoPrevia: false,
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
      expect(ambiente.deviceSecret).toBeNull();
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
  it('exige o app ID do OneSignal E o SDK ligado', () => {
    // Ter a chave no build não basta: sem alguém inicializando o SDK, pedir
    // permissão de push queimaria a única chance que o iOS dá.
    expect(recursosDoBuild(lerAmbiente(COMPLETO)).push).toBe(IMPLEMENTADO.push);

    const semChave = lerAmbiente({
      ...COMPLETO,
      extra: { ...COMPLETO.extra, oneSignalAppId: null },
    });
    expect(recursosDoBuild(semChave).push).toBe(false);
  });

  it('a Fase 3 liga o push', () => {
    expect(IMPLEMENTADO.push).toBe(true);
    expect(recursosDoBuild(lerAmbiente(COMPLETO)).push).toBe(true);
  });

  /*
   * Evento de carrinho NÃO depende do OneSignal. Ele alimenta a análise e o
   * agendamento no servidor, e vale igual para quem recusou a notificação —
   * amarrar os dois faria o lojista perder o dado de quem não aceitou push.
   */
  it('evento de carrinho vale mesmo sem push', () => {
    const semPush = lerAmbiente({
      ...COMPLETO,
      extra: { ...COMPLETO.extra, oneSignalAppId: null },
    });
    expect(recursosDoBuild(semPush).push).toBe(false);
    expect(recursosDoBuild(semPush).eventos).toBe(true);
  });

  it('evento de carrinho exige a credencial da API', () => {
    for (const faltando of [{ appId: null }, { deviceSecret: null }, { apiBase: '' }]) {
      const ambiente = lerAmbiente({
        ...COMPLETO,
        extra: { ...COMPLETO.extra, ...faltando },
      });
      expect(recursosDoBuild(ambiente).eventos).toBe(false);
    }
  });
});

describe('modo de prévia', () => {
  it('fica desligado em app de loja', () => {
    // Nenhum app de cliente pode pedir código: ele abre a loja e pronto.
    expect(lerAmbiente(COMPLETO).modoPrevia).toBe(false);
    expect(lerAmbiente({ ...COMPLETO, extra: { previewMode: 'sim' } }).modoPrevia).toBe(false);
    expect(lerAmbiente({ ...COMPLETO, extra: { previewMode: 1 } }).modoPrevia).toBe(false);
  });

  it('liga só com o booleano verdadeiro do build de prévia', () => {
    expect(lerAmbiente({ ...COMPLETO, extra: { previewMode: true } }).modoPrevia).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { PLUGIN_DE_BIOMETRIA } from './biometria';
import {
  IMPLEMENTADO,
  lerAmbiente,
  lerConfigDoBinario,
  recursosDoBuild,
  type EntradaDoAmbiente,
} from './ambiente';

const EXTRA = {
  storeId: 'oakvintage',
  appId: 'app_123',
  apiBase: 'https://storefy.convertfy.me',
  oneSignalAppId: 'os_abc',
  deviceSecret: 'segredo-deste-build',
  appStoreId: '6478123456',
};

/** O `app.config` como o build o grava: identidade, número e plugins. */
function appConfig(parcial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Oak Vintage',
    version: '1.2.0',
    ios: { buildNumber: '7', bundleIdentifier: 'br.com.oakvintage.app' },
    android: { versionCode: 9, package: 'br.com.oakvintage.app' },
    plugins: ['onesignal-expo-plugin', [PLUGIN_DE_BIOMETRIA, { faceIDPermission: 'x' }]],
    extra: EXTRA,
    ...parcial,
  };
}

/** Recém-instalado, sem correção OTA: manifesto em uso e binário são o mesmo. */
const COMPLETO: EntradaDoAmbiente = {
  manifesto: appConfig(),
  binario: appConfig(),
  buildNativoIos: '7',
  plataforma: 'ios',
};

/** Só o manifesto, como no `expo start` (Expo Go, sem binário de loja). */
function soManifesto(parcial: Record<string, unknown> = {}): EntradaDoAmbiente {
  return { manifesto: appConfig(parcial), binario: null, plataforma: 'ios' };
}

/*
 * O manifesto que o runner do OTA monta: serve a TODOS os binários da loja,
 * então sai sem versão nem número (o padrão do `app.config.ts`, 1), e com a
 * lista de plugins do código novo.
 */
const MANIFESTO_DO_OTA = appConfig({
  version: '1.0.0',
  ios: { buildNumber: '1' },
  android: { versionCode: 1, package: 'br.com.oakvintage.app' },
});

describe('lerAmbiente', () => {
  it('lê o que o build gravou', () => {
    expect(lerAmbiente(COMPLETO)).toEqual({
      storeId: 'oakvintage',
      appId: 'app_123',
      apiBase: 'https://storefy.convertfy.me',
      oneSignalAppId: 'os_abc',
      deviceSecret: 'segredo-deste-build',
      buildAtual: 7,
      appVersion: '1.2.0',
      nomeDoApp: 'Oak Vintage',
      modoPrevia: false,
      appStoreId: '6478123456',
      pacoteAndroid: 'br.com.oakvintage.app',
      biometriaNoBinario: true,
    });
  });

  it('pega o build da plataforma certa', () => {
    expect(lerAmbiente({ ...COMPLETO, plataforma: 'android' }).buildAtual).toBe(9);
  });

  it('build ilegível vira 1, o mais baixo possível', () => {
    // `NaN > minSupportedBuild` é false: um build ilegível passaria por uma
    // versão bloqueada como se estivesse em dia.
    for (const bruto of [null, undefined, '', 'sete', '7abc', '1.5', Number.NaN, 0, -3, 1.5, {}]) {
      expect(
        lerAmbiente(soManifesto({ ios: { buildNumber: bruto } })).buildAtual,
        `${typeof bruto} ${JSON.stringify(bruto)}`,
      ).toBe(1);
    }
  });

  it('abre sem extra nenhum, que é o `expo start` sem variáveis', () => {
    for (const extra of [null, undefined, {}, 'nada', 42]) {
      const ambiente = lerAmbiente(soManifesto({ extra }));
      expect(ambiente.storeId).toBe('');
      expect(ambiente.appId).toBeNull();
      expect(ambiente.oneSignalAppId).toBeNull();
      expect(ambiente.deviceSecret).toBeNull();
      expect(ambiente.appStoreId).toBeNull();
      expect(ambiente.buildAtual).toBe(7);
    }
  });

  it('abre sem manifesto e sem binário', () => {
    const ambiente = lerAmbiente({ manifesto: null, binario: null, plataforma: 'android' });
    expect(ambiente.buildAtual).toBe(1);
    expect(ambiente.appVersion).toBe('0.0.0');
    expect(ambiente.nomeDoApp).toBe('');
    expect(ambiente.pacoteAndroid).toBeNull();
    expect(ambiente.biometriaNoBinario).toBe(false);
  });

  it('string vazia conta como ausente, não como valor', () => {
    const ambiente = lerAmbiente(
      soManifesto({ extra: { storeId: '  ', appId: '', apiBase: '', oneSignalAppId: '   ' } }),
    );
    expect(ambiente.appId).toBeNull();
    expect(ambiente.oneSignalAppId).toBeNull();
    expect(ambiente.apiBase).toBe('');
  });

  it('versão ausente vira 0.0.0 em vez de undefined na página', () => {
    expect(lerAmbiente(soManifesto({ version: null })).appVersion).toBe('0.0.0');
  });
});

/*
 * O defeito que isto conserta: o número e a versão eram lidos do manifesto em
 * uso, que depois da primeira correção OTA é o da correção — 1.0.0 (1) em
 * todo aparelho. Com uma versão mínima 2 no painel, TODO app que recebeu uma
 * correção caía na tela de atualização, até quem tinha acabado de atualizar.
 */
describe('depois de uma correção OTA', () => {
  const DEPOIS_DO_OTA: EntradaDoAmbiente = { ...COMPLETO, manifesto: MANIFESTO_DO_OTA };

  it('o número e a versão continuam os do binário, nas duas plataformas', () => {
    expect(lerAmbiente(DEPOIS_DO_OTA)).toMatchObject({ buildAtual: 7, appVersion: '1.2.0' });
    expect(
      lerAmbiente({ ...DEPOIS_DO_OTA, plataforma: 'android', buildNativoIos: null }).buildAtual,
    ).toBe(9);
  });

  it('no iPhone, o número do Info.plist vale mais que o de qualquer manifesto', () => {
    expect(lerAmbiente({ ...DEPOIS_DO_OTA, buildNativoIos: '12' }).buildAtual).toBe(12);
    // Info.plist ilegível: o `app.config` do binário, e nunca o do OTA.
    expect(lerAmbiente({ ...DEPOIS_DO_OTA, buildNativoIos: null }).buildAtual).toBe(7);
  });

  it('o Android entrega o `app.config` do binário como texto', () => {
    const ambiente = lerAmbiente({
      manifesto: MANIFESTO_DO_OTA,
      binario: JSON.stringify(appConfig()),
      plataforma: 'android',
    });
    expect(ambiente).toMatchObject({ buildAtual: 9, appVersion: '1.2.0' });
  });

  it('as credenciais são as do manifesto em uso: é por ele que a correção as leva', () => {
    const ambiente = lerAmbiente({
      ...COMPLETO,
      manifesto: appConfig({ extra: { ...EXTRA, deviceSecret: 'segredo-novo' } }),
      binario: appConfig({ extra: { ...EXTRA, deviceSecret: null } }),
    });
    expect(ambiente.deviceSecret).toBe('segredo-novo');
  });

  /*
   * A lista de plugins do OTA é a do código novo. Lida dali, um binário
   * gerado antes da permissão de Face ID pediria o Face ID mesmo assim — e o
   * iOS encerra o app que pede sem a permissão no Info.plist.
   */
  it('o Face ID segue o binário, e não a lista de plugins do OTA', () => {
    const semPermissao = lerAmbiente({
      ...COMPLETO,
      manifesto: MANIFESTO_DO_OTA,
      binario: appConfig({ plugins: ['onesignal-expo-plugin'] }),
    });
    expect(semPermissao.biometriaNoBinario).toBe(false);
    expect(lerAmbiente(DEPOIS_DO_OTA).biometriaNoBinario).toBe(true);
  });
});

describe('ficha na loja de aplicativos (M11)', () => {
  it('o número da App Store tem o formato da trava do banco', () => {
    const numero = (valor: unknown) =>
      lerAmbiente({
        ...COMPLETO,
        manifesto: appConfig({ extra: { ...EXTRA, appStoreId: valor } }),
        binario: null,
      }).appStoreId;
    expect(numero(' 647812345 ')).toBe('647812345');
    // O resto some — e a tela diz onde procurar, em vez de abrir a ficha errada.
    for (const invalido of ['', 'abc', '123', '64781234561234567', 'id6478123456', 6478123456]) {
      expect(numero(invalido), String(invalido)).toBeNull();
    }
  });

  it('um OTA sem o número não apaga o que o binário tem', () => {
    const ambiente = lerAmbiente({
      ...COMPLETO,
      manifesto: appConfig({ extra: { ...EXTRA, appStoreId: null } }),
    });
    expect(ambiente.appStoreId).toBe('6478123456');
  });

  it('o pacote Android precisa ter cara de pacote', () => {
    const pacote = (valor: unknown) =>
      lerAmbiente({
        ...COMPLETO,
        manifesto: appConfig({ android: { package: valor } }),
        binario: null,
      }).pacoteAndroid;
    expect(pacote('br.com.oakvintage.app')).toBe('br.com.oakvintage.app');
    for (const invalido of ['', 'semponto', 'br..app', '1br.com.app', 'br.com.app&x=1', null]) {
      expect(pacote(invalido), String(invalido)).toBeNull();
    }
  });
});

describe('lerConfigDoBinario', () => {
  it('aceita o objeto do iOS e o texto do Android', () => {
    expect(lerConfigDoBinario({ name: 'x' })).toEqual({ name: 'x' });
    expect(lerConfigDoBinario('{"name":"x"}')).toEqual({ name: 'x' });
  });

  it('o que não é config conta como ausente', () => {
    for (const bruto of [null, undefined, '', '{quebrado', '[1,2]', '"texto"', 42, [1]]) {
      expect(lerConfigDoBinario(bruto), String(bruto)).toBeNull();
    }
  });
});

describe('recursosDoBuild', () => {
  const comExtra = (extra: Record<string, unknown>) =>
    lerAmbiente({ ...COMPLETO, manifesto: appConfig({ extra: { ...EXTRA, ...extra } }) });

  it('exige o app ID do OneSignal E o SDK ligado', () => {
    // Ter a chave no build não basta: sem alguém inicializando o SDK, pedir
    // permissão de push queimaria a única chance que o iOS dá.
    expect(recursosDoBuild(lerAmbiente(COMPLETO)).push).toBe(IMPLEMENTADO.push);
    expect(recursosDoBuild(comExtra({ oneSignalAppId: null })).push).toBe(false);
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
    const semPush = comExtra({ oneSignalAppId: null });
    expect(recursosDoBuild(semPush).push).toBe(false);
    expect(recursosDoBuild(semPush).eventos).toBe(true);
  });

  it('evento de carrinho exige a credencial da API', () => {
    for (const faltando of [{ appId: null }, { deviceSecret: null }, { apiBase: '' }]) {
      expect(recursosDoBuild(comExtra(faltando)).eventos).toBe(false);
    }
  });
});

describe('modo de prévia', () => {
  const previa = (valor: unknown) =>
    lerAmbiente(soManifesto({ extra: { previewMode: valor } })).modoPrevia;

  it('fica desligado em app de loja', () => {
    // Nenhum app de cliente pode pedir código: ele abre a loja e pronto.
    expect(lerAmbiente(COMPLETO).modoPrevia).toBe(false);
    expect(previa('sim')).toBe(false);
    expect(previa(1)).toBe(false);
  });

  it('liga só com o booleano verdadeiro do build de prévia', () => {
    expect(previa(true)).toBe(true);
  });
});

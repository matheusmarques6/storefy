import { describe, expect, it } from 'vitest';
import {
  PLUGIN_CAMERA,
  PLUGIN_ONESIGNAL,
  montarPlugins,
  nomeDoPlugin,
  type PluginExpo,
} from './plugins';

/** O primeiro plugin, falhando alto se a lista vier vazia. */
function primeiro(plugins: PluginExpo[]): PluginExpo {
  const inicial = plugins[0];
  if (inicial === undefined) throw new Error('A lista de plugins veio vazia.');
  return inicial;
}

describe('montarPlugins — regra 5 do CLAUDE.md', () => {
  it('coloca o onesignal-expo-plugin em PRIMEIRO', () => {
    // Fora de primeiro, o build iOS sai sem capability de push e a falha só
    // aparece na submissão à App Store, sem dizer o motivo.
    const plugins = montarPlugins({ modoApns: 'production' });
    expect(nomeDoPlugin(primeiro(plugins))).toBe(PLUGIN_ONESIGNAL);
  });

  it('mantém o OneSignal em primeiro mesmo com extras', () => {
    const plugins = montarPlugins({
      modoApns: 'production',
      extras: ['expo-haptics', ['expo-build-properties', { ios: {} }]],
    });
    expect(nomeDoPlugin(primeiro(plugins))).toBe(PLUGIN_ONESIGNAL);
  });

  it('ignora um OneSignal repetido nos extras', () => {
    // Plugin nativo duplicado quebra o build de um jeito confuso.
    const plugins = montarPlugins({
      modoApns: 'production',
      extras: [[PLUGIN_ONESIGNAL, { mode: 'development' }]],
    });
    const ocorrencias = plugins.filter((p) => nomeDoPlugin(p) === PLUGIN_ONESIGNAL);
    expect(ocorrencias).toHaveLength(1);
    expect(ocorrencias[0]).toEqual([PLUGIN_ONESIGNAL, { mode: 'production' }]);
  });

  it('repassa o modo APNs escolhido', () => {
    const dev = montarPlugins({ modoApns: 'development' });
    expect(primeiro(dev)).toEqual([PLUGIN_ONESIGNAL, { mode: 'development' }]);
  });

  it('inclui os plugins que todo app nosso usa', () => {
    const nomes = montarPlugins({ modoApns: 'production' }).map(nomeDoPlugin);
    for (const esperado of ['expo-router', 'expo-splash-screen', 'expo-updates']) {
      expect(nomes).toContain(esperado);
    }
  });

  it('mantém o OneSignal em primeiro mesmo configurando o splash', () => {
    const plugins = montarPlugins({
      modoApns: 'production',
      splash: { image: './brands/oakvintage/splash.png', backgroundColor: '#ffffff' },
    });
    expect(nomeDoPlugin(primeiro(plugins))).toBe(PLUGIN_ONESIGNAL);
  });

  it('configura o splash pelo plugin, que é onde ele vive desde o SDK 51', () => {
    const plugins = montarPlugins({
      modoApns: 'production',
      splash: { image: './brands/oakvintage/splash.png', backgroundColor: '#111111' },
    });
    const splash = plugins.find((p) => nomeDoPlugin(p) === 'expo-splash-screen');
    expect(splash).toEqual([
      'expo-splash-screen',
      expect.objectContaining({
        image: './brands/oakvintage/splash.png',
        backgroundColor: '#111111',
      }),
    ]);
  });

  it('não duplica nenhum plugin', () => {
    const nomes = montarPlugins({
      modoApns: 'production',
      extras: ['expo-router', 'expo-haptics'],
    }).map(nomeDoPlugin);
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});

describe('câmera só no app de prévia', () => {
  it('app de loja NÃO pede permissão de câmera', () => {
    // `expo-camera` no array põe "este app quer usar sua câmera" no Info.plist.
    // Num app de loja isso aparece para o cliente final sem nenhuma função que
    // justifique, e é pergunta certa na revisão da Apple.
    const nomes = montarPlugins({ modoApns: 'production' }).map(nomeDoPlugin);
    expect(nomes).not.toContain(PLUGIN_CAMERA);
  });

  it('o app de prévia ganha a câmera, com o motivo escrito', () => {
    const plugins = montarPlugins({ modoApns: 'development', previa: true });
    const camera = plugins.find((plugin) => nomeDoPlugin(plugin) === PLUGIN_CAMERA);
    expect(camera).toBeDefined();
    expect(Array.isArray(camera)).toBe(true);
    if (Array.isArray(camera)) {
      expect(String(camera[1].cameraPermission)).toContain('código do painel');
    }
  });

  it('a câmera não empurra o OneSignal do primeiro lugar', () => {
    const nomes = montarPlugins({ modoApns: 'production', previa: true }).map(nomeDoPlugin);
    expect(nomes[0]).toBe(PLUGIN_ONESIGNAL);
  });
});

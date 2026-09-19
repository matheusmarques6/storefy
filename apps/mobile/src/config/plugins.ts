/**
 * Montagem da lista de plugins nativos do `app.config.ts`.
 *
 * REGRA 5 DO CLAUDE.md: `onesignal-expo-plugin` é SEMPRE o primeiro do array.
 * Fora de primeiro, o build iOS sai sem a capability de push e o app falha com
 * "Missing Push Capability" — só que o erro aparece na submissão à App Store,
 * depois de um build de 20 minutos, e não diz o que está errado.
 *
 * Esta função existe para que a ordem não dependa de alguém lembrar. O teste
 * em `plugins.test.ts` reprova qualquer arranjo que a quebre.
 */

/** Um plugin: só o nome, ou nome com opções. */
export type PluginExpo = string | [string, Record<string, unknown>];

export const PLUGIN_ONESIGNAL = 'onesignal-expo-plugin';
export const PLUGIN_CAMERA = 'expo-camera';

export interface OpcoesDePlugins {
  /**
   * `development` usa o ambiente de sandbox das notificações da Apple.
   * Um build de produção com `development` não recebe push nenhum.
   */
  modoApns: 'development' | 'production';
  /** Splash da loja. A partir do SDK 51 ela é opção do plugin, não campo raiz. */
  splash?: { image: string; backgroundColor: string };
  /**
   * Build do app Storefy Preview.
   *
   * SÓ ELE GANHA A CÂMERA. O leitor de QR é do app de prévia, e `expo-camera`
   * no array pede permissão de câmera no Info.plist — num app de loja isso
   * aparece para o cliente final como "este app quer usar sua câmera", sem
   * nenhuma função que justifique, e é pergunta certa na revisão da Apple.
   */
  previa?: boolean;
  /** Plugins além do OneSignal e dos que todo app nosso usa. */
  extras?: readonly PluginExpo[];
}

/** Nome do plugin, seja ele string ou tupla. */
export function nomeDoPlugin(plugin: PluginExpo): string {
  return typeof plugin === 'string' ? plugin : plugin[0];
}

/**
 * Lista final de plugins, com o OneSignal garantidamente em primeiro.
 *
 * Um `extras` que inclua o OneSignal é ignorado nessa posição: a entrada
 * correta já foi colocada no início, e duplicar plugin nativo quebra o build.
 */
export function montarPlugins(opcoes: OpcoesDePlugins): PluginExpo[] {
  const base: PluginExpo[] = [
    [PLUGIN_ONESIGNAL, { mode: opcoes.modoApns }],
    'expo-router',
    opcoes.splash == null
      ? 'expo-splash-screen'
      : [
          'expo-splash-screen',
          {
            image: opcoes.splash.image,
            backgroundColor: opcoes.splash.backgroundColor,
            resizeMode: 'contain',
            imageWidth: 200,
          },
        ],
    'expo-local-authentication',
    'expo-updates',
  ];

  if (opcoes.previa === true) {
    base.push([
      PLUGIN_CAMERA,
      {
        cameraPermission:
          'O Storefy Preview usa a câmera para ler o código do painel e mostrar o rascunho do seu app.',
        recordAudioAndroid: false,
      },
    ]);
  }

  const jaIncluidos = new Set(base.map(nomeDoPlugin));
  const extras = (opcoes.extras ?? []).filter((plugin) => !jaIncluidos.has(nomeDoPlugin(plugin)));

  return [...base, ...extras];
}

/**
 * Configuração do build, por loja (seção 5.2 do plano).
 *
 * Tudo que muda entre lojas chega por variável de ambiente, injetada pelo
 * workflow `build-store-app.yml`. O arquivo em si é igual para todas: é o que
 * permite um repositório só gerar o app de qualquer cliente.
 *
 * O que EXIGE um build novo: nome, ícone, splash, bundle ID e plugins nativos.
 * Todo o resto — cores, abas, CSS, banners — vem da config remota em tempo de
 * execução, e muda sem passar pela loja de aplicativos.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ExpoConfig } from 'expo/config';
// A extensão é obrigatória: o carregador de config do Expo transpila SÓ este
// arquivo e resolve os imports dele com o `require` do Node, que não conhece
// `.ts`. Sem o `.ts` aqui, todo build morre em "Cannot find module".
import { montarPlugins } from './src/config/plugins.ts';

const ambiente = process.env;

/** Variável obrigatória, com erro que diz qual faltou. */
function exigir(nome: string): string {
  const valor = ambiente[nome];
  if (valor == null || valor === '') {
    throw new Error(
      `app.config.ts: falta a variável ${nome}. ` +
        'Ela é injetada pelo workflow de build por loja (seção 7 do plano).',
    );
  }
  return valor;
}

/** Variável opcional com padrão, para o `expo start` local funcionar. */
function opcional(nome: string, padrao: string): string {
  const valor = ambiente[nome];
  return valor == null || valor === '' ? padrao : valor;
}

const storeId = opcional('STORE_ID', 'oakvintage');

/*
 * Build do app Storefy Preview.
 *
 * Mesma base do app das lojas, com três diferenças: nome e esquema próprios,
 * a câmera para ler o QR do painel, e `extra.previewMode`, que faz o app pedir
 * um código em vez de abrir a loja. Nenhum app de cliente leva nada disso.
 */
const modoPrevia = opcional('PREVIEW_MODE', '') === '1';

/*
 * Ícone e splash são arte da loja: o workflow de build por loja baixa os dois
 * para `brands/$STORE_ID/` antes de chamar o Expo. Num build de loja de
 * verdade — aquele que define `STORE_ID` — a falta de um deles é erro, e não
 * silêncio: o app iria para a App Store com o ícone padrão do Expo. No
 * `expo start` local, sem `STORE_ID`, o padrão do Expo serve.
 */
const buildDeLoja = (ambiente['STORE_ID'] ?? '') !== '' && !modoPrevia;

function arteDaLoja(arquivo: string): string | undefined {
  const relativo = `./brands/${storeId}/${arquivo}`;
  if (existsSync(join(__dirname, 'brands', storeId, arquivo))) return relativo;
  if (buildDeLoja) {
    throw new Error(
      `app.config.ts: falta ${relativo}. ` +
        'O build por loja precisa do ícone e da splash da loja (seção 7 do plano).',
    );
  }
  return undefined;
}

const icone = arteDaLoja('icon.png');
const splash = arteDaLoja('splash.png');
const nomeDoApp = modoPrevia ? 'Storefy Preview' : opcional('APP_NAME', 'Oak Vintage');
const slug = modoPrevia ? 'storefy-preview' : opcional('APP_SLUG', 'storefy-oakvintage');

/*
 * `development` usa o sandbox de push da Apple. Um build de produção com
 * `development` não recebe notificação nenhuma, e nada no app indica isso —
 * por isso o padrão é `production`, e o modo de sandbox precisa ser pedido.
 */
const modoApns =
  opcional('APNS_MODE', 'production') === 'development' ? 'development' : 'production';

const config: ExpoConfig = {
  name: nomeDoApp,
  slug,
  // Conta ou organização dona do projeto no Expo. Sem isso, o EAS pergunta na
  // hora — e num workflow sem ninguém para responder, ele para.
  owner: ambiente['EXPO_OWNER'] ?? undefined,
  scheme: modoPrevia ? 'storefy-preview' : opcional('APP_SCHEME', 'storefy'),
  version: opcional('APP_VERSION', '1.0.0'),
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  // A nova arquitetura é padrão a partir do SDK 57; o campo deixou de existir.

  icon: icone,

  ios: {
    bundleIdentifier: opcional('IOS_BUNDLE_ID', 'me.convertfy.storefy.oakvintage'),
    buildNumber: opcional('IOS_BUILD', '1'),
    supportsTablet: false,
    // Universal Links: faz o link da loja abrir no app em vez do navegador.
    associatedDomains: [`applinks:${opcional('STORE_DOMAIN', 'oakvintage.com.br')}`],
    infoPlist: {
      // A WebView carrega o site do lojista, que pode ter recurso em http.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
    },
  },

  android: {
    package: opcional('ANDROID_PACKAGE', 'me.convertfy.storefy.oakvintage'),
    versionCode: Number.parseInt(opcional('ANDROID_VC', '1'), 10),
    adaptiveIcon:
      icone === undefined
        ? undefined
        : { foregroundImage: icone, backgroundColor: opcional('SPLASH_BG', '#ffffff') },
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: opcional('STORE_DOMAIN', 'oakvintage.com.br') }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },

  // A ordem importa: o OneSignal precisa ser o primeiro. Ver `src/config/plugins.ts`.
  plugins: montarPlugins({
    modoApns,
    previa: modoPrevia,
    splash:
      splash === undefined
        ? undefined
        : { image: splash, backgroundColor: opcional('SPLASH_BG', '#ffffff') },
  }),

  experiments: { typedRoutes: true },

  extra: {
    previewMode: modoPrevia,
    storeId,
    appId: ambiente['STOREFY_APP_ID'] ?? null,
    apiBase: opcional('API_BASE', 'https://storefy.convertfy.me'),
    oneSignalAppId: ambiente['ONESIGNAL_APP_ID'] ?? null,
    /*
     * Segredo com que este build assina o que manda para a Storefy. O painel
     * o gera por app; o pipeline de build o entrega como variável.
     *
     * Ele acaba dentro do binário, como toda chave de cliente de app móvel, e
     * o desenho conta com isso: é um segredo POR LOJA e revogável, não um
     * segredo do produto. Nunca reaproveite o mesmo valor entre lojas.
     */
    deviceSecret: ambiente['STOREFY_DEVICE_SECRET'] ?? null,
    eas: { projectId: ambiente['EAS_PROJECT_ID'] ?? null },
  },

  updates: {
    // Canal por loja: uma correção OTA não vaza de um cliente para outro.
    url:
      ambiente['EAS_PROJECT_ID'] == null
        ? undefined
        : `https://u.expo.dev/${exigir('EAS_PROJECT_ID')}`,
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: { policy: 'appVersion' },
};

export default config;

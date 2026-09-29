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

/*
 * Os padrões abaixo são do DESENVOLVIMENTO LOCAL (`expo start`, sem `STORE_ID`)
 * e não são de loja nenhuma. Num build de loja, a identidade do app vem do
 * workflow, sempre: um padrão aqui faria um build mal configurado sair com o
 * nome, o bundle ou o domínio de OUTRA loja — e o domínio nos links
 * universais faria o app reclamar o site de um cliente que não é o dele.
 */
// A pasta de marca que vem no repositório: é dela que o `expo start` local
// tira a config embutida para abrir alguma loja. Só a config — nome, bundle
// e domínio do app de desenvolvimento são neutros (abaixo).
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

/*
 * Pacote de correção OTA (`ota-update.yml`). O `eas update` avalia este
 * arquivo para montar o manifesto do pacote, mas ícone e splash são do
 * BINÁRIO: o pacote não os leva, e o runner da correção não os baixa. Sem
 * esta distinção, toda correção morria aqui, em "falta ./brands/<loja>/icon.png",
 * antes de publicar. O resto da identidade continua obrigatório.
 *
 * Versão e número do build também ficam no padrão num pacote: ele serve a
 * todos os binários da loja de uma vez. O app lê os dois do próprio binário
 * (`src/nucleo/ambiente.ts`), e não do manifesto em uso.
 */
const pacoteOta = opcional('STOREFY_OTA', '') === '1';

function arteDaLoja(arquivo: string): string | undefined {
  const relativo = `./brands/${storeId}/${arquivo}`;
  if (existsSync(join(__dirname, 'brands', storeId, arquivo))) return relativo;
  if (buildDeLoja && !pacoteOta) {
    throw new Error(
      `app.config.ts: falta ${relativo}. ` +
        'O build por loja precisa do ícone e da splash da loja (seção 7 do plano).',
    );
  }
  return undefined;
}

const icone = arteDaLoja('icon.png');
const splash = arteDaLoja('splash.png');
/** No build de loja, obrigatória; no desenvolvimento, com o padrão neutro. */
function daLoja(nome: string, padraoLocal: string): string {
  return buildDeLoja ? exigir(nome) : opcional(nome, padraoLocal);
}

/**
 * Identificador que a loja pode não ter (um app só Android não tem bundle
 * iOS). Ausente, o campo fica de fora — e o EAS recusa o build da plataforma
 * que precisar dele, dizendo qual é. Nunca o de outra loja.
 */
function identificador(nome: string, padraoLocal: string): string | undefined {
  const valor = ambiente[nome];
  if (valor != null && valor !== '') return valor;
  return buildDeLoja ? undefined : padraoLocal;
}

const nomeDoApp = modoPrevia ? 'Storefy Preview' : daLoja('APP_NAME', 'Storefy Dev');
const slug = modoPrevia ? 'storefy-preview' : daLoja('APP_SLUG', 'storefy-desenvolvimento');

/*
 * O domínio da loja: links universais (iOS) e App Links (Android). Sem ele,
 * nenhum domínio é reclamado — que é o certo para quem não tem site próprio,
 * e para o desenvolvimento local.
 */
const dominioDaLoja = (ambiente['STORE_DOMAIN'] ?? '').trim();

/*
 * `development` usa o sandbox de push da Apple. Um build de produção com
 * `development` não recebe notificação nenhuma, e nada no app indica isso —
 * por isso o padrão é `production`, e o modo de sandbox precisa ser pedido.
 */
const modoApns =
  opcional('APNS_MODE', 'production') === 'development' ? 'development' : 'production';

/*
 * A versão do CÓDIGO NATIVO, e não a do app na loja.
 *
 * Era `{ policy: 'appVersion' }`: o runtime acompanhava a versão da loja. Com
 * a versão subindo a cada binário (1.0.<n>, reservada pelo banco), cada app
 * teria um runtime diferente, e a correção OTA — publicada para UM runtime —
 * só alcançaria os apps daquele número exato. O runtime diz quais binários
 * aceitam o mesmo JavaScript, e todo app da Storefy sai do mesmo código
 * nativo: o runtime é um só.
 *
 * Mude este valor SÓ quando o nativo mudar (módulo novo, plugin novo), e
 * publique os binários novos antes da próxima correção OTA.
 *
 * '1.0.0' não é arbitrário: é o runtime que os binários gerados até aqui já
 * têm — todos saíam como 1.0.0 —, e trocá-lo agora cortaria esses apps das
 * correções OTA.
 */
const RUNTIME_NATIVO = '1.0.0';

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
    bundleIdentifier: identificador('IOS_BUNDLE_ID', 'me.convertfy.storefy.desenvolvimento'),
    buildNumber: opcional('IOS_BUILD', '1'),
    supportsTablet: false,
    // Universal Links: faz o link da loja abrir no app em vez do navegador.
    associatedDomains: dominioDaLoja === '' ? [] : [`applinks:${dominioDaLoja}`],
    infoPlist: {
      // A WebView carrega o site do lojista, que pode ter recurso em http.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
    },
  },

  android: {
    package: identificador('ANDROID_PACKAGE', 'me.convertfy.storefy.desenvolvimento'),
    versionCode: Number.parseInt(opcional('ANDROID_VC', '1'), 10),
    adaptiveIcon:
      icone === undefined
        ? undefined
        : { foregroundImage: icone, backgroundColor: opcional('SPLASH_BG', '#ffffff') },
    intentFilters:
      dominioDaLoja === ''
        ? []
        : [
            {
              action: 'VIEW',
              autoVerify: true,
              data: [{ scheme: 'https', host: dominioDaLoja }],
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
    /*
     * O número do app na App Store (`apps.ios_asc_app_id`). A atualização
     * obrigatória (M11) abre a ficha do app por ele — a Apple não tem link
     * pelo bundle ID. O painel só libera o build de iPhone com o app já
     * criado lá, então todo build de loja o tem.
     */
    appStoreId: ambiente['IOS_APP_STORE_ID'] ?? null,
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
  runtimeVersion: RUNTIME_NATIVO,
};

export default config;

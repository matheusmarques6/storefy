/**
 * O que este build sabe sobre si mesmo (seção 5.2 do plano).
 *
 * Tudo vem do `app.config.ts`, que o workflow de build por loja preenche. A
 * leitura fica separada do `expo-constants` de propósito: assim a parte que
 * pode dar errado — `extra` vazio, `appId` faltando, build sem número — é
 * função pura e testável sem aparelho.
 *
 * DUAS FONTES, E A DIFERENÇA IMPORTA. O manifesto EM USO
 * (`Constants.expoConfig`) é o do binário só até chegar a primeira correção
 * OTA; dali em diante é o da correção, montado no runner do OTA para TODOS os
 * binários da loja de uma vez — ele não tem como saber o número de cada um, e
 * sai com o padrão, 1. Lido dali, o build de todo aparelho que recebeu uma
 * correção virava 1, e a primeira versão mínima acima disso prendia todo
 * mundo na tela de atualização, inclusive quem acabou de atualizar.
 *
 * O `app.config` que o build gravou DENTRO do binário, esse nenhuma correção
 * troca. Então: número do build, versão e plugins nativos são do BINÁRIO;
 * credenciais e endereços são do manifesto EM USO, que é justamente por onde
 * uma correção os leva a quem saiu sem eles.
 */
import { binarioComBiometria } from './biometria';

export interface Ambiente {
  /** Pasta em `brands/` e chave do registro de configs embutidas. */
  storeId: string;
  /** ID do app na Storefy. Sem ele não há config remota, só a embutida. */
  appId: string | null;
  /** Base da API da Storefy. */
  apiBase: string;
  /** App ID do OneSignal. Null enquanto o push não estiver configurado. */
  oneSignalAppId: string | null;
  /**
   * Segredo com que este build assina o que manda para a Storefy.
   *
   * Viaja dentro do binário, e isso é sabido: quem desmonta o app acha. O que
   * ele garante não é sigilo, é que o acesso é por loja e revogável — o
   * lojista gera outro e o vazado morre na hora.
   */
  deviceSecret: string | null;
  /** Número do build instalado, comparado com `minSupportedBuild`. Do binário. */
  buildAtual: number;
  /** Versão que aparece para o usuário, entregue à página em `__STOREFY__`. Do binário. */
  appVersion: string;
  /** O nome do app, como aparece embaixo do ícone e na loja de aplicativos. */
  nomeDoApp: string;
  /**
   * Este é o app Storefy Preview?
   *
   * Ele não abre loja nenhuma sozinho: pede um código do painel e mostra o
   * RASCUNHO daquela loja. Nenhum app de cliente traz isto ligado.
   */
  modoPrevia: boolean;
  /**
   * O número do app na App Store (`apps.ios_asc_app_id`): é por ele que a
   * atualização obrigatória (M11) abre a ficha do app. Null fora de um build
   * de loja — e num binário gerado antes de o campo existir, até a próxima
   * correção OTA, que o entrega.
   */
  appStoreId: string | null;
  /** O pacote Android: é por ele que a ficha do app abre no Google Play. */
  pacoteAndroid: string | null;
  /**
   * O binário foi gerado com a permissão de Face ID? A lista de plugins do
   * manifesto de uma correção é a do código NOVO, e não a do binário que a
   * recebeu: lida dali, um app sem a permissão pediria o Face ID mesmo assim.
   */
  biometriaNoBinario: boolean;
}

export interface EntradaDoAmbiente {
  /** O manifesto em uso: `Constants.expoConfig`. */
  manifesto: unknown;
  /**
   * O `app.config` que o build gravou no binário, como o nativo o entrega:
   * texto JSON no Android, objeto no iOS. Ausente só fora de um build de
   * verdade (Expo Go) — e aí vale o manifesto em uso, como antes.
   */
  binario: unknown;
  /** O `CFBundleVersion` do Info.plist, lido pelo nativo. Só no iOS. */
  buildNativoIos?: unknown;
  plataforma: 'ios' | 'android';
}

type Objeto = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function textoOuNulo(valor: unknown): string | null {
  const limpo = texto(valor);
  return limpo === '' ? null : limpo;
}

function objeto(valor: unknown): Objeto | null {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    ? (valor as Objeto)
    : null;
}

/**
 * O `app.config` gravado no binário. O Android o entrega como texto, o iOS
 * como objeto; um texto que não é JSON conta como ausente, e o app segue com
 * o manifesto em uso.
 */
export function lerConfigDoBinario(bruto: unknown): Objeto | null {
  if (typeof bruto !== 'string') return objeto(bruto);
  let lido: unknown;
  try {
    lido = JSON.parse(bruto);
  } catch {
    return null;
  }
  return objeto(lido);
}

/** `config.<secao>.<nome>`, quando existe. */
function campo(config: Objeto | null, secao: string, nome: string): unknown {
  return objeto(config?.[secao])?.[nome];
}

/**
 * Um número de build de verdade: inteiro positivo, em número ou em texto só
 * de dígitos. "7abc", "1.5" e zero não são build de ninguém.
 */
function numeroDoBuild(bruto: unknown): number | null {
  if (typeof bruto === 'number') return Number.isInteger(bruto) && bruto > 0 ? bruto : null;
  const limpo = texto(bruto);
  if (!/^\d{1,9}$/.test(limpo)) return null;
  const numero = Number.parseInt(limpo, 10);
  return numero > 0 ? numero : null;
}

/** O formato de `apps.ios_asc_app_id`, o mesmo da trava no banco. */
function idDaAppStore(valor: unknown): string | null {
  const limpo = texto(valor);
  return /^[0-9]{6,15}$/.test(limpo) ? limpo : null;
}

/** Um pacote Android: `com.loja.app`, com pelo menos dois segmentos. */
function pacoteAndroid(valor: unknown): string | null {
  const limpo = texto(valor);
  return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(limpo) ? limpo : null;
}

/**
 * Lê o que este build sabe sobre si.
 *
 * Nada aqui estoura: um `extra` vazio é o estado normal de `expo start` sem
 * variáveis, e o app tem que abrir assim mesmo, com a config embutida.
 */
export function lerAmbiente(entrada: EntradaDoAmbiente): Ambiente {
  const manifesto = objeto(entrada.manifesto);
  const binario = lerConfigDoBinario(entrada.binario);
  const extra = objeto(manifesto?.extra) ?? {};
  const extraDoBinario = objeto(binario?.extra) ?? {};

  /*
   * O número do BINÁRIO primeiro: o do Info.plist (iOS), depois o do
   * `app.config` embutido. O do manifesto em uso só vale sem os dois — fora
   * de um build de verdade, onde não há correção OTA para confundir.
   */
  const candidatos =
    entrada.plataforma === 'ios'
      ? [
          entrada.buildNativoIos,
          campo(binario, 'ios', 'buildNumber'),
          campo(manifesto, 'ios', 'buildNumber'),
        ]
      : [campo(binario, 'android', 'versionCode'), campo(manifesto, 'android', 'versionCode')];
  const buildDoBinario = candidatos.map(numeroDoBuild).find((numero) => numero !== null);

  return {
    storeId: texto(extra.storeId),
    appId: textoOuNulo(extra.appId),
    apiBase: texto(extra.apiBase),
    oneSignalAppId: textoOuNulo(extra.oneSignalAppId),
    deviceSecret: textoOuNulo(extra.deviceSecret),
    // Build desconhecido conta como 1, o mais baixo possível. Um `NaN` na
    // comparação com `minSupportedBuild` daria false e deixaria passar uma
    // versão que deveria ser bloqueada.
    buildAtual: buildDoBinario ?? 1,
    appVersion: textoOuNulo(binario?.version) ?? textoOuNulo(manifesto?.version) ?? '0.0.0',
    nomeDoApp: textoOuNulo(binario?.name) ?? texto(manifesto?.name),
    modoPrevia: extra.previewMode === true,
    // O número da App Store não muda depois de gravado; a correção OTA o leva
    // aos binários que saíram antes de ele existir.
    appStoreId: idDaAppStore(extra.appStoreId) ?? idDaAppStore(extraDoBinario.appStoreId),
    pacoteAndroid:
      pacoteAndroid(campo(manifesto, 'android', 'package')) ??
      pacoteAndroid(campo(binario, 'android', 'package')),
    biometriaNoBinario: binarioComBiometria((binario ?? manifesto)?.plugins),
  };
}

/** O que o app já sabe fazer, independente do que o build configurou. */
export interface RecursosImplementados {
  /**
   * O OneSignal está ligado no app?
   *
   * Ter `ONESIGNAL_APP_ID` no build NÃO basta: alguém precisa inicializar o
   * SDK, senão uma `REQUEST_PUSH_PERMISSION` chegaria a um `case` que não faz
   * nada. No iOS o sistema mostra o pedido UMA vez; gastar essa vez sem ter
   * onde registrar o aparelho é perder o cliente para sempre, em silêncio.
   */
  push: boolean;
}

/** Ligado na Fase 3: o SDK é inicializado e o aparelho é registrado. */
export const IMPLEMENTADO: RecursosImplementados = { push: true };

/** Os recursos nativos que este build realmente tem. */
export function recursosDoBuild(ambiente: Ambiente): {
  push: boolean;
  eventos: boolean;
} {
  return {
    push: IMPLEMENTADO.push && ambiente.oneSignalAppId !== null,
    /*
     * Evento de carrinho não depende do OneSignal: ele alimenta a análise e o
     * agendamento no servidor, e vale mesmo para quem recusou a notificação.
     * O que ele exige é a credencial da API — sem `appId` ou sem segredo não
     * há para onde mandar, e o app funciona igual sem isso.
     */
    eventos: ambiente.appId !== null && ambiente.deviceSecret !== null && ambiente.apiBase !== '',
  };
}

/**
 * O que este build sabe sobre si mesmo (seção 5.2 do plano).
 *
 * Tudo vem do `extra` do `app.config.ts`, que o workflow de build por loja
 * preenche. A leitura fica separada do `expo-constants` de propósito: assim a
 * parte que pode dar errado — `extra` vazio, `appId` faltando, build sem
 * número — é função pura e testável sem aparelho.
 */

export interface Ambiente {
  /** Pasta em `brands/` e chave do registro de configs embutidas. */
  storeId: string;
  /** ID do app na Storefy. Sem ele não há config remota, só a embutida. */
  appId: string | null;
  /** Base da API da Storefy. */
  apiBase: string;
  /** App ID do OneSignal. Null enquanto o push não estiver configurado. */
  oneSignalAppId: string | null;
  /** Número do build instalado, comparado com `minSupportedBuild`. */
  buildAtual: number;
  /** Versão que aparece para o usuário, entregue à página em `__STOREFY__`. */
  appVersion: string;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function textoOuNulo(valor: unknown): string | null {
  const limpo = texto(valor);
  return limpo === '' ? null : limpo;
}

/**
 * Lê o `extra` do build.
 *
 * Nada aqui estoura: um `extra` vazio é o estado normal de `expo start` sem
 * variáveis, e o app tem que abrir assim mesmo, com a config embutida.
 */
export function lerAmbiente(entrada: {
  extra: unknown;
  plataforma: 'ios' | 'android';
  versao: unknown;
  buildIos: unknown;
  buildAndroid: unknown;
}): Ambiente {
  const extra =
    entrada.extra !== null && typeof entrada.extra === 'object'
      ? (entrada.extra as Record<string, unknown>)
      : {};

  const bruto = entrada.plataforma === 'ios' ? entrada.buildIos : entrada.buildAndroid;
  const numero = typeof bruto === 'number' ? bruto : Number.parseInt(texto(bruto), 10);

  return {
    storeId: texto(extra.storeId),
    appId: textoOuNulo(extra.appId),
    apiBase: texto(extra.apiBase),
    oneSignalAppId: textoOuNulo(extra.oneSignalAppId),
    // Build desconhecido conta como 1, o mais baixo possível. Um `NaN` na
    // comparação com `minSupportedBuild` daria false e deixaria passar uma
    // versão que deveria ser bloqueada.
    buildAtual: Number.isInteger(numero) && numero > 0 ? numero : 1,
    appVersion: texto(entrada.versao) === '' ? '0.0.0' : texto(entrada.versao),
  };
}

/** Os recursos nativos que este build realmente tem. */
export function recursosDoBuild(ambiente: Ambiente): {
  push: boolean;
  eventos: boolean;
} {
  return {
    // O OneSignal entra na Fase 4. Sem o app ID, pedir permissão de push
    // queimaria a única chance que o iOS dá, sem ter onde registrar ninguém.
    push: ambiente.oneSignalAppId !== null,
    // `cart_events` e `orders` chegam na Fase 5, com o `appId` e a API.
    eventos: false,
  };
}

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
  /**
   * Segredo com que este build assina o que manda para a Storefy.
   *
   * Viaja dentro do binário, e isso é sabido: quem desmonta o app acha. O que
   * ele garante não é sigilo, é que o acesso é por loja e revogável — o
   * lojista gera outro e o vazado morre na hora.
   */
  deviceSecret: string | null;
  /** Número do build instalado, comparado com `minSupportedBuild`. */
  buildAtual: number;
  /** Versão que aparece para o usuário, entregue à página em `__STOREFY__`. */
  appVersion: string;
  /**
   * Este é o app Storefy Preview?
   *
   * Ele não abre loja nenhuma sozinho: pede um código do painel e mostra o
   * RASCUNHO daquela loja. Nenhum app de cliente traz isto ligado.
   */
  modoPrevia: boolean;
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
    deviceSecret: textoOuNulo(extra.deviceSecret),
    // Build desconhecido conta como 1, o mais baixo possível. Um `NaN` na
    // comparação com `minSupportedBuild` daria false e deixaria passar uma
    // versão que deveria ser bloqueada.
    buildAtual: Number.isInteger(numero) && numero > 0 ? numero : 1,
    appVersion: texto(entrada.versao) === '' ? '0.0.0' : texto(entrada.versao),
    modoPrevia: extra.previewMode === true,
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

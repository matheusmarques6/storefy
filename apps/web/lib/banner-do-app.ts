/**
 * O que o site da loja precisa saber para convidar a baixar o app (seção 5.6).
 *
 * POR QUE ISTO VEM DO SERVIDOR, e não de um campo que o lojista preenche no
 * editor de tema: os links da App Store e da Play Store são a mesma informação
 * que já está no painel, e pedir para o lojista achar e colar os dois é
 * exatamente o tipo de trabalho que o produto existe para eliminar. O bloco do
 * tema sabe só o domínio da loja — que o Liquid entrega de graça — e pergunta
 * o resto aqui.
 *
 * Puro de propósito: o que entra é o que o banco devolveu, e o que sai é o que
 * o navegador do cliente final recebe. Nada aqui chega perto de um segredo.
 */

/** O bloco só aparece quando há PARA ONDE mandar a pessoa. */
export interface DadosDoBanner {
  /** `features.appBanner` da config publicada. */
  ligado: boolean;
  texto: string;
  /** `apps.ios_asc_app_id`, o número do app na App Store. */
  appStoreId: string | null;
  /** `apps.package_android`, o identificador na Play Store. */
  pacoteAndroid: string | null;
}

export interface RespostaDoBanner {
  ativo: boolean;
  texto: string;
  ios: string | null;
  android: string | null;
  /** O que o Safari do iPhone lê na meta `apple-itunes-app`. */
  smartBanner: string | null;
}

export const TEXTO_PADRAO = 'Baixe nosso app e compre mais rápido.';

/** Quantos caracteres cabem numa tarja de celular sem quebrar em três linhas. */
export const MAXIMO_DO_TEXTO = 90;

export function montarBanner(dados: DadosDoBanner | null): RespostaDoBanner {
  const vazio: RespostaDoBanner = {
    ativo: false,
    texto: '',
    ios: null,
    android: null,
    smartBanner: null,
  };

  if (dados?.ligado !== true) return vazio;

  const ios = linkDaAppStore(dados.appStoreId);
  const android = linkDaPlayStore(dados.pacoteAndroid);

  /*
   * Sem nenhum link não há banner. Um convite para baixar um app que ainda não
   * está em loja nenhuma leva o cliente a um erro — e o erro fica na vitrine
   * do lojista, não na nossa.
   */
  if (ios === null && android === null) return vazio;

  return {
    ativo: true,
    texto: textoDoBanner(dados.texto),
    ios,
    android,
    smartBanner: dados.appStoreId === null ? null : `app-id=${dados.appStoreId}`,
  };
}

/** O texto do lojista, cortado no limite. Vazio vira o padrão. */
export function textoDoBanner(bruto: string): string {
  const limpo = bruto.trim().replace(/\s+/g, ' ');
  if (limpo === '') return TEXTO_PADRAO;
  return limpo.length <= MAXIMO_DO_TEXTO ? limpo : `${limpo.slice(0, MAXIMO_DO_TEXTO - 1)}…`;
}

/**
 * O link da App Store a partir do id numérico.
 *
 * Só dígitos: o id vem do nosso banco, mas ele é preenchido por um assistente
 * que fala com a Apple, e um valor estranho ali viraria um link para um
 * endereço que não controlamos.
 */
export function linkDaAppStore(id: string | null): string | null {
  if (id == null || !/^\d+$/.test(id.trim())) return null;
  return `https://apps.apple.com/app/id${id.trim()}`;
}

/** O link da Play Store a partir do nome do pacote. */
export function linkDaPlayStore(pacote: string | null): string | null {
  if (pacote == null) return null;
  const limpo = pacote.trim();
  // Mesmo formato que o Android exige: segmentos separados por ponto.
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(limpo)) return null;
  return `https://play.google.com/store/apps/details?id=${limpo}`;
}

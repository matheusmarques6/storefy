/**
 * Quando pedir permissão de notificação (M03 do plano).
 *
 * O iOS mostra o pedido do sistema UMA VEZ. Quem toca em "não permitir" só
 * volta atrás indo nos Ajustes do aparelho, o que quase ninguém faz. Então o
 * pedido do sistema não é uma pergunta: é uma aposta, e ela se faz uma vez só.
 *
 * Por isso existe o pré-prompt: uma tela nossa, que explica o que a loja vai
 * mandar, e só chama o pedido do sistema para quem disse sim. Quem disser
 * "agora não" continua podendo ser perguntado de novo depois — e é essa
 * diferença que faz a taxa de aceitação dobrar.
 *
 * Tudo aqui é decisão pura: nenhuma chamada ao SDK, nenhum disco, nenhum
 * React. O que entra é o estado, o que sai é o que fazer.
 */

export type PermissaoDoSistema =
  /** Ainda dá para perguntar. */
  | 'nao-perguntado'
  | 'concedida'
  /** Já recusou no sistema. Só pelos Ajustes do aparelho (tela M12). */
  | 'negada';

/** O que já aconteceu com o pré-prompt neste aparelho. */
export interface HistoricoDoPrePrompt {
  /** Quantas vezes o cliente disse "agora não". */
  recusas: number;
  /** Quando foi a última recusa. */
  ultimaRecusaMs: number | null;
}

export const HISTORICO_VAZIO: HistoricoDoPrePrompt = { recusas: 0, ultimaRecusaMs: null };

/** O que provocou a pergunta. */
export type Gatilho =
  /** O app acabou de abrir. */
  | 'abertura'
  /** O cliente pôs algo no carrinho: é quando ele mais quer ser avisado. */
  | 'carrinho'
  /** A página pediu, porque o cliente clicou em algo como "me avise". */
  | 'pedido-da-pagina';

/**
 * Quando o LOJISTA escolheu perguntar (`features.pushPromptTiming`).
 *
 *   `onboarding`               — logo nas primeiras aberturas;
 *   `after_first_add_to_cart`  — só depois de o cliente montar um carrinho;
 *   `manual`                   — só quando a loja pedir, por um botão na
 *                                página. Quem escolhe isso não quer que o app
 *                                pergunte sozinho, e ignorar essa escolha
 *                                queimaria a única chance do iOS num momento
 *                                que o lojista decidiu que não era o certo.
 */
export type MomentoEscolhido = 'onboarding' | 'after_first_add_to_cart' | 'manual';

export type DecisaoDaPermissao =
  /** Mostrar a nossa tela de explicação. */
  | { acao: 'pre-prompt' }
  /** Chamar o pedido do sistema direto: a intenção já está clara. */
  | { acao: 'pedir-ao-sistema' }
  /** Não perguntar nada agora. */
  | { acao: 'nada'; motivo: string };

/**
 * Quantas vezes insistir depois de um "agora não".
 *
 * Três no total. Insistir mais do que isso não converte — irrita, e quem
 * desinstala o app não volta.
 */
export const MAXIMO_DE_RECUSAS = 3;

/** Quanto esperar depois de um "agora não". Uma semana. */
export const ESPERA_APOS_RECUSA_MS = 7 * 24 * 60 * 60 * 1000;

export interface EstadoDaPermissao {
  sistema: PermissaoDoSistema;
  historico: HistoricoDoPrePrompt;
  /** Quantas vezes este cliente já abriu o app, contando esta. */
  aberturas: number;
  gatilho: Gatilho;
  agoraMs: number;
  /** O push está ligado neste build? Sem OneSignal não há o que pedir. */
  disponivel: boolean;
  /** O que o lojista escolheu na config da loja. */
  momento: MomentoEscolhido;
}

export function decidirPermissao(estado: EstadoDaPermissao): DecisaoDaPermissao {
  if (!estado.disponivel) {
    return { acao: 'nada', motivo: 'Push não configurado neste app.' };
  }
  if (estado.sistema === 'concedida') {
    return { acao: 'nada', motivo: 'O cliente já aceita notificações.' };
  }
  if (estado.sistema === 'negada') {
    // Chamar o pedido do sistema aqui não mostra nada: ele já foi usado. A
    // saída é a tela de ajustes do app, que manda para os Ajustes do aparelho.
    return { acao: 'nada', motivo: 'Recusado no sistema; só pelos Ajustes do aparelho.' };
  }

  /*
   * O cliente clicou em algo na loja pedindo para ser avisado. A intenção já
   * está dada — um pré-prompt aqui seria um toque a mais para dizer o que ele
   * acabou de dizer.
   */
  if (estado.gatilho === 'pedido-da-pagina') return { acao: 'pedir-ao-sistema' };

  if (estado.historico.recusas >= MAXIMO_DE_RECUSAS) {
    return { acao: 'nada', motivo: 'Já dissemos o bastante; insistir afasta.' };
  }

  if (estado.historico.ultimaRecusaMs !== null) {
    const desde = estado.agoraMs - estado.historico.ultimaRecusaMs;
    if (desde < ESPERA_APOS_RECUSA_MS) {
      return { acao: 'nada', motivo: 'Perguntamos há pouco.' };
    }
  }

  /*
   * O lojista escolheu `manual`: só a própria loja pergunta, por um botão na
   * página. O caso `pedido-da-pagina` já foi atendido acima; daqui para baixo
   * é o app perguntando por conta própria, e é exatamente isso que ele não
   * quer.
   */
  if (estado.momento === 'manual') {
    return { acao: 'nada', motivo: 'A loja escolheu perguntar só pela página.' };
  }

  /*
   * Pôr algo no carrinho é o melhor momento que existe: o cliente quer aquele
   * produto e entende na hora o valor de ser avisado sobre ele.
   */
  if (estado.gatilho === 'carrinho') return { acao: 'pre-prompt' };

  // O lojista pediu para esperar o primeiro carrinho. A abertura não serve.
  if (estado.momento === 'after_first_add_to_cart') {
    return { acao: 'nada', motivo: 'A loja escolheu perguntar depois do primeiro carrinho.' };
  }

  /*
   * Na PRIMEIRA abertura, não. O cliente ainda não viu a loja, não sabe se
   * gosta, e a pergunta chega como cobrança. Da segunda em diante ele já tem
   * do que gostar.
   */
  if (estado.aberturas < 2) {
    return { acao: 'nada', motivo: 'Primeira abertura: deixe o cliente conhecer a loja.' };
  }

  return { acao: 'pre-prompt' };
}

/** O histórico depois de um "agora não". */
export function registrarRecusa(
  historico: HistoricoDoPrePrompt,
  agoraMs: number,
): HistoricoDoPrePrompt {
  return { recusas: historico.recusas + 1, ultimaRecusaMs: agoraMs };
}

/**
 * Lê o histórico guardado no disco, tolerando qualquer lixo.
 *
 * O que está no disco foi escrito por uma versão anterior do app, e um
 * `JSON.parse` que lance aqui impediria o app de abrir — muito pior do que
 * perder a contagem de recusas.
 */
export function lerHistorico(bruto: string | null): HistoricoDoPrePrompt {
  if (bruto === null || bruto.trim() === '') return HISTORICO_VAZIO;

  let lido: unknown;
  try {
    lido = JSON.parse(bruto);
  } catch {
    return HISTORICO_VAZIO;
  }
  if (lido === null || typeof lido !== 'object') return HISTORICO_VAZIO;

  const objeto = lido as Record<string, unknown>;
  const recusas = objeto.recusas;
  const ultima = objeto.ultimaRecusaMs;

  return {
    recusas: typeof recusas === 'number' && Number.isInteger(recusas) && recusas >= 0 ? recusas : 0,
    ultimaRecusaMs:
      typeof ultima === 'number' && Number.isFinite(ultima) && ultima > 0 ? ultima : null,
  };
}

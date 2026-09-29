/**
 * Os erros do próprio app, para o alerta da Storefy (Fase 8).
 *
 * Um erro de JavaScript no app — um estouro numa tela nativa, uma promessa
 * sem `catch` — acontece no celular de um cliente de loja, longe de qualquer
 * log. Sem isto, ninguém saberia até o lojista reclamar. O relator pega o
 * erro pelo manipulador global do React Native, manda (assinado, como tudo
 * que o app manda) e devolve o erro ao manipulador de antes, que segue fazendo
 * o que fazia.
 *
 * O QUE NÃO VAI: mais de cinco por abertura do app, o mesmo erro duas vezes,
 * e qualquer coisa da página da loja — o erro do tema do lojista acontece
 * DENTRO da WebView, e não passa por aqui.
 */

export interface ErroDoApp {
  tipo: string;
  mensagem: string;
  pilha?: string;
  /** O React Native vai fechar o app depois deste. */
  fatal: boolean;
}

export const LIMITES_DO_ERRO_DO_APP = { tipo: 100, mensagem: 500, pilha: 5000 } as const;
export const MAXIMO_POR_ABERTURA = 5;

export function montarErroDoApp(erro: unknown, fatal: boolean): ErroDoApp | null {
  const tipo = erro instanceof Error ? erro.name : 'Error';
  const mensagem = (erro instanceof Error ? erro.message : String(erro)).trim();
  if (mensagem === '') return null;
  const pilha = erro instanceof Error ? erro.stack : undefined;
  return {
    tipo: tipo.slice(0, LIMITES_DO_ERRO_DO_APP.tipo),
    mensagem: mensagem.slice(0, LIMITES_DO_ERRO_DO_APP.mensagem),
    ...(pilha === undefined ? {} : { pilha: pilha.slice(0, LIMITES_DO_ERRO_DO_APP.pilha) }),
    fatal,
  };
}

/** Lembra o que já mandou nesta abertura. `enviar` é injetado para o teste. */
export function criarRelatorDoApp(enviar: (erro: ErroDoApp) => void) {
  const vistos = new Set<string>();
  return (erro: unknown, fatal: boolean): boolean => {
    const pacote = montarErroDoApp(erro, fatal);
    if (pacote === null) return false;
    const chave = `${pacote.tipo}:${pacote.mensagem}`;
    if (vistos.has(chave) || vistos.size >= MAXIMO_POR_ABERTURA) return false;
    vistos.add(chave);
    try {
      enviar(pacote);
    } catch {
      // Relatar um erro não pode virar outro.
    }
    return true;
  };
}

/** O pedaço do `ErrorUtils` do React Native que o relator usa. */
export interface ManipuladorGlobal {
  getGlobalHandler: () => (erro: unknown, fatal?: boolean) => void;
  setGlobalHandler: (manipulador: (erro: unknown, fatal?: boolean) => void) => void;
}

/**
 * Põe o relator na frente do manipulador global, e devolve como tirar.
 * O manipulador de antes continua sendo chamado: é ele que mostra a tela
 * vermelha em desenvolvimento e fecha o app num erro fatal.
 */
export function instalarRelatorDeErros(
  relatar: (erro: unknown, fatal: boolean) => void,
  utilidades: ManipuladorGlobal,
): () => void {
  const anterior = utilidades.getGlobalHandler();
  utilidades.setGlobalHandler((erro, fatal) => {
    try {
      relatar(erro, fatal === true);
    } catch {
      // Segue para o manipulador de antes de qualquer jeito.
    }
    anterior(erro, fatal);
  });
  return () => {
    utilidades.setGlobalHandler(anterior);
  };
}

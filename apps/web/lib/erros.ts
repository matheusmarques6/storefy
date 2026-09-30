import { log } from '@/lib/log';
/**
 * Reconhece os erros que o Next lança de propósito para controlar navegação.
 *
 * `redirect()` e `notFound()` sinalizam pela propriedade `digest`, não pela
 * mensagem: o formato é `NEXT_REDIRECT;replace;/lojas;303;`. Um `catch` que
 * compare `erro.message` não reconhece nenhum dos dois e acaba mostrando um
 * erro para o usuário logo depois de uma ação que deu certo.
 *
 * Existe um `isRedirectError` interno no Next, mas ele vive em
 * `next/dist/client/components/...`, caminho privado que muda sem aviso entre
 * versões. Esta checagem depende só do formato público do digest.
 */

function digestDe(erro: unknown): string | null {
  if (typeof erro !== 'object' || erro === null || !('digest' in erro)) return null;
  const { digest } = erro as { digest?: unknown };
  return typeof digest === 'string' ? digest : null;
}

/** True quando o "erro" é, na verdade, um redirecionamento do Next. */
export function ehRedirecionamentoDoNext(erro: unknown): boolean {
  return digestDe(erro)?.startsWith('NEXT_REDIRECT') ?? false;
}

/** True quando o "erro" é, na verdade, um notFound() do Next. */
export function ehNotFoundDoNext(erro: unknown): boolean {
  return digestDe(erro) === 'NEXT_NOT_FOUND';
}

/** True para qualquer sinal de controle de fluxo do Next, que não deve virar toast. */
export function ehControleDeFluxoDoNext(erro: unknown): boolean {
  return ehRedirecionamentoDoNext(erro) || ehNotFoundDoNext(erro);
}

/**
 * Um erro escrito PARA a tela: a frase dele é para o lojista ler, como está.
 *
 * Qualquer outro erro que chega à tela vem do motor — do Next, do navegador,
 * da rede — e fala inglês técnico: em produção o Next troca toda mensagem de
 * erro do servidor por "An error occurred in the Server Components render…",
 * a rede fora vira "Failed to fetch", e o painel aberto antes de uma
 * atualização pede pedaços que não existem mais. Esses viram uma frase nossa.
 */
export class ErroParaATela extends Error {
  override name = 'ErroParaATela';
}

/** O que houve, nas situações que a tela sabe explicar. */
export type SituacaoDoErro =
  'para-a-tela' | 'painel-atualizado' | 'sem-conexao' | 'servidor' | 'outro';

export function situacaoDoErro(erro: unknown): SituacaoDoErro {
  if (erro instanceof ErroParaATela) return 'para-a-tela';
  if (!(erro instanceof Error)) return 'outro';
  const { name, message } = erro;
  // O painel aberto antes de uma atualização pede o código (chunk) e as ações
  // da versão velha, que a nova não tem mais.
  if (
    name === 'ChunkLoadError' ||
    name === 'UnrecognizedActionError' ||
    /Loading (CSS )?chunk|dynamically imported module|Server Action .* was not found/i.test(message)
  ) {
    return 'painel-atualizado';
  }
  if (
    /Failed to fetch|NetworkError|Load failed|Network request failed|fetch failed/i.test(message)
  ) {
    return 'sem-conexao';
  }
  // Veio do servidor: o `digest` é o código do erro no log, e a mensagem, em
  // produção, é a frase genérica do Next.
  if (digestDe(erro) !== null || /Server Components render|unexpected response/i.test(message)) {
    return 'servidor';
  }
  return 'outro';
}

/** A frase de cada situação que não depende da tela em que aconteceu. */
export const FRASE_DO_ERRO = {
  'painel-atualizado':
    'O painel foi atualizado enquanto você o usava. Recarregue a página para continuar.',
  'sem-conexao': 'Sem conexão com a Storefy. Confira a internet e tente de novo.',
} as const;

/**
 * A mensagem de um erro para o lojista: a nossa, quando ele foi escrito para a
 * tela; a do caso, quando é um que conhecemos; senão, a reserva de quem chama,
 * que sabe o que estava sendo feito.
 */
export function mensagemDeErro(erro: unknown, reserva: string): string {
  const situacao = situacaoDoErro(erro);
  if (situacao === 'para-a-tela' && erro instanceof Error && erro.message !== '') {
    return erro.message;
  }
  if (situacao === 'painel-atualizado' || situacao === 'sem-conexao') {
    return FRASE_DO_ERRO[situacao];
  }
  return reserva;
}

/** Uma falha do Supabase — do PostgREST ou do Auth: o código e o texto originais. */
export interface FalhaDoSupabase {
  code?: string | undefined;
  message: string;
}

/**
 * O texto da falha, quando fomos NÓS que o escrevemos; senão `null`.
 *
 * As mensagens do Postgres e do Supabase chegam em inglês e com detalhe
 * interno — "new row violates row-level security policy for table stores",
 * "JWT expired", "fetch failed" —, e chegavam assim na tela do lojista. As das
 * nossas funções SQL são frases em português escritas para ele, e saem com
 * P0001, o código padrão do `raise exception`. Só essas atravessam.
 *
 * Mensagem nossa de diagnóstico, no formato `rotina: detalhe`, também não
 * atravessa: ela é para o log, não para a tela.
 */
export function textoNossoDaFalha(falha: FalhaDoSupabase): string | null {
  if (falha.code !== 'P0001') return null;
  const texto = falha.message.trim();
  if (texto === '' || /^[a-z_]+:/.test(texto)) return null;
  return texto;
}

/**
 * A mensagem de uma falha, pronta para o lojista ler — e o detalhe técnico no
 * log do servidor, onde ele serve para alguém.
 *
 * `onde` é a área do evento no log (`lojas.falha-do-banco`, com o código e o
 * texto do Postgres), para quem investigar saber de que tela veio.
 */
export function mensagemDaFalha(onde: string, falha: FalhaDoSupabase, reserva: string): string {
  const nosso = textoNossoDaFalha(falha);
  if (nosso !== null) return nosso;

  log.erro(`${onde}.falha-do-banco`, { codigo: falha.code ?? 'sem código', texto: falha.message });
  return reserva;
}

/** O texto de reserva quando não há o que dizer de mais específico. */
export const FALHA_GENERICA = 'Não foi possível concluir agora. Tente de novo em instantes.';

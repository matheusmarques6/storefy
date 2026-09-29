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

/** Mensagem para exibir ao usuário, com um texto de reserva legível. */
export function mensagemDeErro(erro: unknown, reserva: string): string {
  if (erro instanceof Error && erro.message !== '') return erro.message;
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
 * `onde` é a etiqueta do log (`[lojas] 42P01 relation ... does not exist`),
 * para quem investigar saber de que tela veio.
 */
export function mensagemDaFalha(onde: string, falha: FalhaDoSupabase, reserva: string): string {
  const nosso = textoNossoDaFalha(falha);
  if (nosso !== null) return nosso;

  console.error(`[${onde}]`, falha.code ?? 'sem código', falha.message);
  return reserva;
}

/** O texto de reserva quando não há o que dizer de mais específico. */
export const FALHA_GENERICA = 'Não foi possível concluir agora. Tente de novo em instantes.';

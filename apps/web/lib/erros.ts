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

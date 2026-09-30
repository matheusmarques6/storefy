/**
 * O recado do login para quem perdeu a sessão no meio do uso — saiu em outra
 * aba, trocou a senha em outro aparelho. O `proxy` manda para o login com
 * `aviso=sessao-encerrada`, e o painel do cliente e o admin dizem a mesma
 * coisa: o que houve, que ela volta à tela em que estava, e — sem esconder —
 * que o que não tinha sido salvo precisa ser feito de novo.
 */
export const TEXTO_DA_SESSAO_ENCERRADA =
  'Sua sessão terminou. Entre de novo para voltar à tela em que você estava — o que ainda não tinha sido salvo precisa ser feito de novo.';

/** O valor de `aviso` na URL do login. */
export const AVISO_DA_SESSAO_ENCERRADA = 'sessao-encerrada';

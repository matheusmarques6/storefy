/**
 * Uma leitura do banco que NÃO PODE virar "vazio" quando falha.
 *
 * `const { data } = await supabase...` joga o `error` fora: com o banco fora
 * do ar, a lista vem vazia e a tela diz "nenhuma campanha", "nunca publicado",
 * "loja não encontrada" — e o lojista age em cima da mentira (cria de novo, ou
 * publica de novo). Passando por aqui, o erro vira exceção: a tela de erro do
 * painel, com "tentar de novo", e o alerta da equipe (`instrumentation.ts`).
 *
 * `lib/leituras-com-erro.test.ts` reprova leitura de tela que não passe por
 * aqui nem olhe o `error` por conta própria.
 */
export function lido<T extends { error: { message: string } | null }>(
  resultado: T,
  oQue: string,
): T {
  if (resultado.error != null) {
    throw new Error(`Não foi possível ler ${oQue}: ${resultado.error.message}`);
  }
  return resultado;
}

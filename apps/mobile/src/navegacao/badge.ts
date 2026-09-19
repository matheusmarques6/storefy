/**
 * O número que aparece sobre o ícone da aba.
 *
 * Parece detalhe, mas é o que o cliente olha para saber se o "adicionar ao
 * carrinho" funcionou. Um carrinho com 137 itens não pode empurrar a barra de
 * abas para os lados, e um carrinho vazio não mostra bolinha nenhuma.
 */

/** Acima disto o número vira "99+". */
export const MAXIMO_VISIVEL = 99;

/** O texto do badge, ou `null` quando não há nada a mostrar. */
export function rotuloDoBadge(quantidade: number): string | null {
  if (!Number.isFinite(quantidade)) return null;
  const inteiro = Math.floor(quantidade);
  if (inteiro <= 0) return null;
  return inteiro > MAXIMO_VISIVEL ? `${MAXIMO_VISIVEL}+` : String(inteiro);
}

/** Como o leitor de tela anuncia a aba de avisos. */
export function descricaoDeAvisos(quantidade: number): string | null {
  const inteiro = Math.floor(quantidade);
  if (!Number.isFinite(quantidade) || inteiro <= 0) return null;
  return inteiro === 1 ? '1 aviso não lido' : `${String(inteiro)} avisos não lidos`;
}

/** Como o leitor de tela anuncia a aba do carrinho. */
export function descricaoDoBadge(quantidade: number): string | null {
  const inteiro = Math.floor(quantidade);
  if (!Number.isFinite(quantidade) || inteiro <= 0) return null;
  return inteiro === 1 ? '1 item no carrinho' : `${inteiro} itens no carrinho`;
}

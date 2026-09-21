/**
 * As decisões dos números diários (seção 9 do plano).
 *
 * Puro e testável, separado do IO como o resto: o que decide quanto tempo
 * recalcular não pode depender de ter um banco na frente.
 */

/** Quantos dias o job recalcula quando ninguém pede outra coisa. */
export const JANELA_PADRAO = 3;

/**
 * O teto existe do lado do banco também, e de propósito.
 *
 * `consolidar_analytics` limita a 90 dias porque ela é chamável por outros
 * caminhos um dia; aqui o limite volta a aparecer para a rota não mandar um
 * número absurdo e receber um resultado diferente do que pediu, sem aviso.
 */
export const JANELA_MAXIMA = 90;

/**
 * Quantos dias recalcular, a partir do `?dias=` da chamada.
 *
 * Três por padrão: o dia de ontem ainda não acabou em todo fuso quando acaba
 * aqui, a Shopify reentrega webhook por horas e o aparelho sem rede reporta
 * depois. Um dia só deixaria esses atrasados de fora para sempre.
 *
 * Qualquer coisa que não seja um inteiro vira o padrão. Um `?dias=abc` que
 * virasse `NaN` faria o banco recalcular a janela mínima em silêncio.
 */
export function janelaDaConsolidacao(bruto: string | null | undefined): number {
  if (bruto == null || !/^\d+$/.test(bruto.trim())) return JANELA_PADRAO;

  const numero = Number(bruto.trim());
  if (!Number.isSafeInteger(numero) || numero < 1) return JANELA_PADRAO;

  return Math.min(numero, JANELA_MAXIMA);
}

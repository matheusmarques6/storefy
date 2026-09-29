/**
 * A troca de aba, sentida e vista (seção 10 do plano: "animações nativas de
 * troca de aba, haptics sutis… Nada pode parecer site dentro do app").
 *
 * Sem isto, trocar de aba era trocar de página: o conteúdo novo aparecia de
 * uma vez, sem nenhum sinal na mão — exatamente a sensação de site.
 *
 * - O dedo sente a troca: o toque de seleção do sistema, o mesmo que o iOS dá
 *   num seletor. No Android, o "tique" de tecla, que respeita o "retorno ao
 *   toque" desligado nos ajustes do aparelho.
 * - O olho vê: o conteúdo novo entra com um esmaecer curto a partir da cor de
 *   fundo da loja, e o ícone da aba escolhida dá um pulo pequeno.
 *
 * Com "Reduzir movimento" ligado no aparelho, nada se mexe — a troca é
 * imediata, como antes. O toque na mão continua: ele não é movimento.
 */

/** Curto o bastante para não atrasar ninguém; longo o bastante para se ver. */
export const DURACAO_DA_TROCA_MS = 180;

/** Quanto o ícone cresce no pulo, antes de voltar. */
export const ESCALA_DO_ICONE = 1.15;

export interface EfeitoDaTroca {
  /** O toque de seleção na mão. */
  vibrar: boolean;
  /** O esmaecer do conteúdo e o pulo do ícone. */
  animar: boolean;
}

export function efeitoDaTroca(entrada: {
  /** Tocou na aba que já estava aberta (volta ao começo dela). */
  reabrir: boolean;
  /** "Reduzir movimento" ligado nos ajustes do aparelho. */
  movimentoReduzido: boolean;
}): EfeitoDaTroca {
  /*
   * A aba que já está aberta volta ao começo: a própria página mudando é o
   * retorno. Vibrar e esmaecer ali seria sinal de troca onde não houve troca.
   */
  if (entrada.reabrir) return { vibrar: false, animar: false };
  return { vibrar: true, animar: !entrada.movimentoReduzido };
}

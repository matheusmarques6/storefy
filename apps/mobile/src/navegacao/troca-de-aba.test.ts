import { describe, expect, it } from 'vitest';
import { DURACAO_DA_TROCA_MS, ESCALA_DO_ICONE, efeitoDaTroca } from './troca-de-aba';

describe('efeitoDaTroca', () => {
  it('trocar de aba: o toque na mão e o movimento', () => {
    expect(efeitoDaTroca({ reabrir: false, movimentoReduzido: false })).toEqual({
      vibrar: true,
      animar: true,
    });
  });

  /* Quem pediu menos movimento ao aparelho não ganha animação — mas o toque na mão fica. */
  it('com "Reduzir movimento", troca sem animar', () => {
    expect(efeitoDaTroca({ reabrir: false, movimentoReduzido: true })).toEqual({
      vibrar: true,
      animar: false,
    });
  });

  /* A aba aberta volta ao começo: a página mudando já é o retorno. */
  it('tocar na aba que já está aberta não é troca', () => {
    for (const movimentoReduzido of [false, true]) {
      expect(efeitoDaTroca({ reabrir: true, movimentoReduzido })).toEqual({
        vibrar: false,
        animar: false,
      });
    }
  });

  it('o movimento é curto e o pulo é pequeno', () => {
    // Mais que isso já atrasa quem troca de aba rápido; menos, ninguém vê.
    expect(DURACAO_DA_TROCA_MS).toBeGreaterThanOrEqual(120);
    expect(DURACAO_DA_TROCA_MS).toBeLessThanOrEqual(250);
    expect(ESCALA_DO_ICONE).toBeGreaterThan(1);
    expect(ESCALA_DO_ICONE).toBeLessThanOrEqual(1.2);
  });
});

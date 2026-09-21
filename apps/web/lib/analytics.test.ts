import { describe, expect, it } from 'vitest';
import { JANELA_MAXIMA, JANELA_PADRAO, janelaDaConsolidacao } from '@/lib/analytics';

describe('janelaDaConsolidacao', () => {
  it('sem parâmetro, recalcula a janela padrão', () => {
    expect(janelaDaConsolidacao(null)).toBe(JANELA_PADRAO);
    expect(janelaDaConsolidacao(undefined)).toBe(JANELA_PADRAO);
    expect(janelaDaConsolidacao('')).toBe(JANELA_PADRAO);
  });

  it('aceita um número de dias', () => {
    expect(janelaDaConsolidacao('7')).toBe(7);
    expect(janelaDaConsolidacao('  30  ')).toBe(30);
    expect(janelaDaConsolidacao('1')).toBe(1);
  });

  /*
   * `?dias=abc` virando `NaN` faria o banco recalcular a janela mínima em
   * silêncio — e os dias atrasados ficariam de fora para sempre.
   */
  it('o que não é inteiro positivo vira o padrão, e não NaN', () => {
    for (const bruto of ['abc', '-5', '3.5', '1e3', ' ', '0', 'null', '٣']) {
      expect(janelaDaConsolidacao(bruto), bruto).toBe(JANELA_PADRAO);
    }
  });

  it('e o teto é respeitado', () => {
    expect(janelaDaConsolidacao('9999')).toBe(JANELA_MAXIMA);
    expect(janelaDaConsolidacao('90')).toBe(JANELA_MAXIMA);
  });

  it('número grande demais para ser inteiro seguro não passa', () => {
    expect(janelaDaConsolidacao('99999999999999999999')).toBe(JANELA_PADRAO);
  });
});

import { describe, expect, it } from 'vitest';
import { MAXIMO_VISIVEL, descricaoDoBadge, rotuloDoBadge } from './badge';

describe('rotuloDoBadge', () => {
  it('mostra a quantidade quando há itens', () => {
    expect(rotuloDoBadge(1)).toBe('1');
    expect(rotuloDoBadge(12)).toBe('12');
    expect(rotuloDoBadge(MAXIMO_VISIVEL)).toBe('99');
  });

  it('esconde a bolinha no carrinho vazio', () => {
    expect(rotuloDoBadge(0)).toBeNull();
    expect(rotuloDoBadge(-3)).toBeNull();
  });

  it('corta em 99+ para não empurrar a barra de abas', () => {
    expect(rotuloDoBadge(100)).toBe('99+');
    expect(rotuloDoBadge(1370)).toBe('99+');
  });

  it('não desenha nada com número que não é número', () => {
    expect(rotuloDoBadge(Number.NaN)).toBeNull();
    expect(rotuloDoBadge(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('arredonda para baixo em vez de mostrar decimal', () => {
    expect(rotuloDoBadge(2.9)).toBe('2');
  });
});

describe('descricaoDoBadge', () => {
  it('fala em português e concorda no singular', () => {
    expect(descricaoDoBadge(1)).toBe('1 item no carrinho');
    expect(descricaoDoBadge(3)).toBe('3 itens no carrinho');
  });

  it('não anuncia carrinho vazio', () => {
    expect(descricaoDoBadge(0)).toBeNull();
    expect(descricaoDoBadge(Number.NaN)).toBeNull();
  });

  it('fala o número real mesmo quando o badge mostra 99+', () => {
    // Quem usa leitor de tela não deve ouvir "noventa e nove mais".
    expect(rotuloDoBadge(137)).toBe('99+');
    expect(descricaoDoBadge(137)).toBe('137 itens no carrinho');
  });
});

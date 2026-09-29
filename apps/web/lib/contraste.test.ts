import { describe, expect, it } from 'vitest';
import { TEMA_PADRAO, type AppConfig } from '@storefy/config-schema';
import { luminancia, problemasDeContraste, razaoDeContraste, textoDaRazao } from '@/lib/contraste';

const BOM: AppConfig['theme'] = {
  primary: '#1a1a1a',
  background: '#ffffff',
  text: '#1a1a1a',
  tabBarBg: '#ffffff',
  tabBarActive: '#1a1a1a',
  tabBarInactive: '#6b7280',
  statusBar: 'dark',
};

describe('razaoDeContraste', () => {
  it('os extremos e os valores de referência da WCAG', () => {
    expect(razaoDeContraste('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(razaoDeContraste('#fff', '#fff')).toBe(1);
    // O cinza mais claro que ainda passa 4,5:1 sobre branco é #767676.
    expect(razaoDeContraste('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(razaoDeContraste('#777777', '#ffffff')).toBeLessThan(4.5);
    // A ordem não importa.
    expect(razaoDeContraste('#ffffff', '#767676')).toBe(razaoDeContraste('#767676', '#ffffff'));
  });

  it('cor que não é hexadecimal não tem razão', () => {
    expect(luminancia('red')).toBeNull();
    expect(razaoDeContraste('#12345', '#ffffff')).toBeNull();
  });
});

describe('problemasDeContraste', () => {
  it('um tema legível não tem aviso', () => {
    expect(problemasDeContraste(BOM)).toEqual([]);
  });

  /* Toda loja nova começa com este tema: um aviso nele apareceria para todo mundo. */
  it('o tema com que toda loja começa passa', () => {
    expect(problemasDeContraste(TEMA_PADRAO)).toEqual([]);
  });

  it('cada par ilegível vira um aviso, com a razão e o mínimo', () => {
    const problemas = problemasDeContraste({
      ...BOM,
      // Cinza claro nas abas não abertas: bonito, e some no sol.
      tabBarInactive: '#d1d5db',
      // Botão amarelo com o texto branco do fundo.
      primary: '#facc15',
    });
    expect(problemas.map((problema) => [problema.onde, problema.minimo])).toEqual([
      ['O texto dos botões e do aviso do topo, que usa a cor de fundo sobre a principal', 4.5],
      ['As abas que não estão abertas', 3],
    ]);
    expect(problemas[0]?.campos).toEqual(['primary', 'background']);
    expect(problemas[0]?.razao).toBeLessThan(2);
  });

  /* O erro mais comum: fundo escuro com a barra de status ainda de ícones pretos. */
  it('ícones da barra de status sumindo no fundo, com o conserto', () => {
    const escuro = {
      ...BOM,
      background: '#0f172a',
      text: '#f8fafc',
      primary: '#f8fafc',
    };
    const [problema] = problemasDeContraste(escuro);
    expect(problema?.onde).toBe('A hora e a bateria, na barra de status');
    expect(problema?.dica).toBe('Escolha "Ícones claros" em Barra de status.');
    expect(problemasDeContraste({ ...escuro, statusBar: 'light' })).toEqual([]);
  });

  it('e o contrário: ícones claros num fundo claro', () => {
    const [problema] = problemasDeContraste({ ...BOM, statusBar: 'light' });
    expect(problema?.onde).toBe('A hora e a bateria, na barra de status');
    expect(problema?.dica).toBe('Escolha "Ícones escuros" em Barra de status.');
  });
});

describe('textoDaRazao', () => {
  it('uma casa, com vírgula, e sem arredondar para cima', () => {
    expect(textoDaRazao(2.137)).toBe('2,1:1');
    // 4,47 não pode aparecer como 4,5 — pareceria que passa.
    expect(textoDaRazao(4.47)).toBe('4,4:1');
    expect(textoDaRazao(3)).toBe('3:1');
    expect(textoDaRazao(4.5)).toBe('4,5:1');
  });
});

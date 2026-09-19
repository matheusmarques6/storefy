import { describe, expect, it } from 'vitest';
import { NOMES_DE_ICONE, ROTULO_DO_ICONE, ehNomeDeIcone } from './icones';
import { ABAS_PADRAO } from './inicial';

describe('nomes de ícone', () => {
  it('nenhum nome se repete', () => {
    expect(new Set(NOMES_DE_ICONE).size).toBe(NOMES_DE_ICONE.length);
  });

  it('todo nome tem rótulo em português para o seletor', () => {
    for (const nome of NOMES_DE_ICONE) {
      expect(ROTULO_DO_ICONE[nome], nome).toBeTruthy();
    }
  });

  it('os ícones da config inicial estão na lista', () => {
    // Senão a loja nasceria com um ícone que o editor não sabe mostrar.
    for (const aba of ABAS_PADRAO) {
      expect(ehNomeDeIcone(aba.icon), aba.icon).toBe(true);
    }
  });

  it('ehNomeDeIcone normaliza espaço e maiúscula', () => {
    expect(ehNomeDeIcone('  HOUSE ')).toBe(true);
    expect(ehNomeDeIcone('Shopping-Bag')).toBe(true);
  });

  it('recusa o que não está na lista', () => {
    for (const nome of ['', '   ', 'icone-inventado', 'constructor', 'toString']) {
      expect(ehNomeDeIcone(nome), nome).toBe(false);
    }
  });
});

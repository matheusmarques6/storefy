import { describe, expect, it } from 'vitest';
import { NOMES_DE_ICONE, ehNomeDeIcone } from '@storefy/config-schema';
import { ICONES_DO_PAINEL, ICONE_PADRAO_DO_PAINEL, iconeDoPainel } from '@/lib/icones-do-painel';

describe('ícones do painel', () => {
  it('TODO nome de ícone do contrato tem desenho no painel', () => {
    // O que o lojista não consegue ver, ele não escolhe.
    const semDesenho = NOMES_DE_ICONE.filter((nome) => !Object.hasOwn(ICONES_DO_PAINEL, nome));
    expect(semDesenho).toEqual([]);
  });

  it('o painel não desenha nome que o contrato não conhece', () => {
    const apelidos = ['home', 'bag', 'cart', 'account', 'notifications'];
    const fora = Object.keys(ICONES_DO_PAINEL).filter(
      (nome) => !ehNomeDeIcone(nome) && !apelidos.includes(nome),
    );
    expect(fora).toEqual([]);
  });

  it('cai no padrão em vez de sumir com a aba', () => {
    for (const nome of ['', '   ', 'inventado', 'constructor', 'toString']) {
      expect(iconeDoPainel(nome)).toBe(ICONE_PADRAO_DO_PAINEL);
    }
  });

  it('não se importa com espaço nem com maiúscula', () => {
    expect(iconeDoPainel('  HOUSE ')).toBe(ICONES_DO_PAINEL.house);
  });
});

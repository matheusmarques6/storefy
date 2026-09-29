import { describe, expect, it } from 'vitest';
import { configInicial } from '@storefy/config-schema';
import {
  anuncioDaOrdem,
  deslocamentoDaVizinha,
  destinoDoArraste,
  velocidadeDaRolagem,
} from '@/lib/arrastar-abas';
import { moverAba } from '@/lib/editor-de-config';

// Quatro abas, uma embaixo da outra, com o centro de 100 em 100 pixels.
const CENTROS = [50, 150, 250, 350];

describe('destinoDoArraste', () => {
  it('a última arrastada para cima de tudo vira a primeira', () => {
    expect(destinoDoArraste(CENTROS, 20, 3)).toBe(0);
  });

  it('a primeira arrastada para baixo de tudo vira a última', () => {
    expect(destinoDoArraste(CENTROS, 400, 0)).toBe(3);
  });

  it('parada onde estava, fica onde estava', () => {
    expect(destinoDoArraste(CENTROS, 250, 2)).toBe(2);
  });

  it('só troca com a vizinha depois de passar do centro dela', () => {
    expect(destinoDoArraste(CENTROS, 140, 0)).toBe(0);
    expect(destinoDoArraste(CENTROS, 160, 0)).toBe(1);
    expect(destinoDoArraste(CENTROS, 60, 1)).toBe(1);
    expect(destinoDoArraste(CENTROS, 40, 1)).toBe(0);
  });

  it('o destino, dado a `moverAba`, põe a aba onde ela foi solta', () => {
    const config = configInicial({ name: 'Oak', url: 'https://oak.com.br' });
    const ultima = config.tabs.length - 1;
    const centros = config.tabs.map((_, indice) => 50 + indice * 100);
    const movida = moverAba(config, ultima, destinoDoArraste(centros, 20, ultima));
    expect(movida.tabs[0]?.id).toBe(config.tabs[ultima]?.id);
    expect(movida.tabs.slice(1).map((aba) => aba.id)).toEqual(
      config.tabs.slice(0, ultima).map((aba) => aba.id),
    );
  });
});

describe('deslocamentoDaVizinha', () => {
  it('descendo da 1ª para a 3ª, a 2ª e a 3ª sobem um passo; as outras ficam', () => {
    expect([0, 1, 2, 3].map((indice) => deslocamentoDaVizinha(indice, 0, 2, 112))).toEqual([
      0, -112, -112, 0,
    ]);
  });

  it('subindo da 4ª para a 2ª, a 2ª e a 3ª descem um passo', () => {
    expect([0, 1, 2, 3].map((indice) => deslocamentoDaVizinha(indice, 3, 1, 112))).toEqual([
      0, 112, 112, 0,
    ]);
  });

  it('sem mudança de lugar, ninguém anda', () => {
    expect([0, 1, 2, 3].map((indice) => deslocamentoDaVizinha(indice, 2, 2, 112))).toEqual([
      0, 0, 0, 0,
    ]);
  });
});

describe('velocidadeDaRolagem', () => {
  it('no meio da janela a página fica parada', () => {
    expect(velocidadeDaRolagem(400, 800)).toBe(0);
    expect(velocidadeDaRolagem(96, 800)).toBe(0);
    expect(velocidadeDaRolagem(736, 800)).toBe(0);
  });

  it('perto do alto sobe, mais rápido quanto mais perto da borda', () => {
    expect(velocidadeDaRolagem(90, 800)).toBeLessThan(0);
    expect(velocidadeDaRolagem(0, 800)).toBeLessThan(velocidadeDaRolagem(90, 800));
    expect(velocidadeDaRolagem(-50, 800)).toBe(velocidadeDaRolagem(0, 800));
  });

  it('perto do pé desce, com o mesmo teto de velocidade', () => {
    expect(velocidadeDaRolagem(740, 800)).toBeGreaterThan(0);
    expect(velocidadeDaRolagem(800, 800)).toBe(-velocidadeDaRolagem(0, 800));
    expect(velocidadeDaRolagem(900, 800)).toBe(velocidadeDaRolagem(800, 800));
  });
});

describe('anuncioDaOrdem', () => {
  it('diz o nome e a nova posição', () => {
    expect(anuncioDaOrdem(' Buscar ', 1, 4)).toBe('“Buscar” agora é a 2ª de 4 abas.');
  });

  it('aba sem nome ainda tem anúncio', () => {
    expect(anuncioDaOrdem('  ', 0, 3)).toBe('A aba sem nome agora é a 1ª de 3 abas.');
  });
});

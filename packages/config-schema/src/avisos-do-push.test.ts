import { describe, expect, it } from 'vitest';
import { avisosDasAutomacoes, lerAvisosDoPush } from './avisos-do-push';
import { avisosDasAutomacoes as doIndice } from './index';

describe('avisosDasAutomacoes', () => {
  it('cada aviso depende da automação dele estar ligada', () => {
    expect(avisosDasAutomacoes([])).toEqual([]);
    expect(avisosDasAutomacoes(['order_shipped'])).toEqual(['pedido']);
    expect(avisosDasAutomacoes(['back_in_stock', 'abandoned_cart', 'welcome'])).toEqual([
      'carrinho',
      'estoque',
    ]);
  });

  it('boas-vindas, inativos e o webhook não viram promessa no pedido de permissão', () => {
    expect(avisosDasAutomacoes(['welcome', 'inactive_7d', 'custom_webhook'])).toEqual([]);
  });

  it('sai pelo índice do pacote', () => {
    expect(doIndice(['order_shipped'])).toEqual(['pedido']);
  });
});

describe('lerAvisosDoPush', () => {
  it('lê a resposta da rota e descarta o que não conhece', () => {
    expect(lerAvisosDoPush({ avisos: ['estoque', 'pedido'] })).toEqual(['pedido', 'estoque']);
    expect(lerAvisosDoPush({ avisos: ['carrinho', 'pix', 1] })).toEqual(['carrinho']);
    expect(lerAvisosDoPush({ avisos: [] })).toEqual([]);
  });

  it('resposta fora do formato é "não sei", e não "nenhum aviso"', () => {
    for (const dados of [null, undefined, 'avisos', { avisos: 'pedido' }, {}]) {
      expect(lerAvisosDoPush(dados), JSON.stringify(dados)).toBeNull();
    }
  });
});

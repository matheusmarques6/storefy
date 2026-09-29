import { describe, expect, it } from 'vitest';
import {
  ATRIBUTO_DO_PUSH,
  FOLGA_DO_RELOGIO_MS,
  JANELA_DO_PUSH_MS,
  dadosDaOrigem,
  lerAtributoDoPush,
  origemDaNotificacao,
  toqueAindaVale,
  valorDoAtributoDoPush,
  type OrigemDoPush,
} from './atribuicao-do-push';
import { ATRIBUTO_DO_PUSH as DO_INDICE, lerAtributoDoPush as lerDoIndice } from './index';

const CAMPANHA: OrigemDoPush = { tipo: 'campanha', id: '11111111-1111-4111-8111-111111111111' };
const AUTOMACAO: OrigemDoPush = { tipo: 'automacao', id: '22222222-2222-4222-8222-222222222222' };
const TOQUE = 1_790_000_000_000;

describe('a origem vai e volta pela notificação', () => {
  it('o despachante escreve, o app lê a mesma origem', () => {
    expect(origemDaNotificacao({ deep_link: '/x', ...dadosDaOrigem(CAMPANHA) })).toEqual(CAMPANHA);
    expect(origemDaNotificacao(dadosDaOrigem(AUTOMACAO))).toEqual(AUTOMACAO);
  });

  it('notificação sem origem nossa, ou com id que não é uuid, não tem origem', () => {
    expect(origemDaNotificacao({ deep_link: '/x' })).toBeNull();
    expect(origemDaNotificacao({ campanha: 'drop table' })).toBeNull();
    expect(origemDaNotificacao(null)).toBeNull();
    expect(origemDaNotificacao('campanha')).toBeNull();
  });

  it('id em maiúsculas é normalizado', () => {
    expect(origemDaNotificacao({ campanha: CAMPANHA.id.toUpperCase() })).toEqual(CAMPANHA);
  });
});

describe('a origem vai e volta pelo carrinho', () => {
  it('o app grava, o webhook lê a mesma origem e a hora do toque', () => {
    for (const origem of [CAMPANHA, AUTOMACAO]) {
      expect(lerAtributoDoPush(valorDoAtributoDoPush({ origem, tocadaEmMs: TOQUE }))).toEqual({
        origem,
        tocadaEmMs: TOQUE,
      });
    }
  });

  it('a hora viaja em segundos: o valor cabe no atributo sem os milissegundos', () => {
    expect(valorDoAtributoDoPush({ origem: CAMPANHA, tocadaEmMs: TOQUE + 999 })).toBe(
      `c:${CAMPANHA.id}:${String(TOQUE / 1000)}`,
    );
  });

  it('atributo vazio, forjado ou de outro formato não é push', () => {
    for (const valor of [
      '',
      'c:',
      `c:${CAMPANHA.id}`,
      `x:${CAMPANHA.id}:1790000000`,
      'c:nao-e-uuid:1790000000',
      `c:${CAMPANHA.id}:0`,
      `c:${CAMPANHA.id}:-5`,
      `c:${CAMPANHA.id}:1e9`,
      `c:${CAMPANHA.id}:1790000000:extra`,
      42,
      null,
      undefined,
    ]) {
      expect(lerAtributoDoPush(valor), String(valor)).toBeNull();
    }
  });

  it('o atributo começa com underscore, que a Shopify esconde do cliente', () => {
    expect(ATRIBUTO_DO_PUSH.startsWith('_')).toBe(true);
  });

  it('sai pelo índice do pacote, que é o contrato', () => {
    expect(DO_INDICE).toBe(ATRIBUTO_DO_PUSH);
    expect(lerDoIndice).toBe(lerAtributoDoPush);
  });
});

describe('toqueAindaVale', () => {
  it('vale por três dias a partir do toque', () => {
    expect(toqueAindaVale(TOQUE, TOQUE)).toBe(true);
    expect(toqueAindaVale(TOQUE, TOQUE + JANELA_DO_PUSH_MS)).toBe(true);
    expect(toqueAindaVale(TOQUE, TOQUE + 30 * 24 * 60 * 60 * 1000)).toBe(false);
  });

  it('o relógio do celular tem uma hora de folga, nas duas pontas', () => {
    expect(toqueAindaVale(TOQUE, TOQUE - 5 * 60 * 1000)).toBe(true);
    expect(toqueAindaVale(TOQUE, TOQUE - FOLGA_DO_RELOGIO_MS - 1)).toBe(false);
    expect(toqueAindaVale(TOQUE, TOQUE + JANELA_DO_PUSH_MS + FOLGA_DO_RELOGIO_MS)).toBe(true);
    expect(toqueAindaVale(TOQUE, TOQUE + JANELA_DO_PUSH_MS + FOLGA_DO_RELOGIO_MS + 1)).toBe(false);
  });

  it('hora que não é número não vale', () => {
    expect(toqueAindaVale(Number.NaN, TOQUE)).toBe(false);
    expect(toqueAindaVale(TOQUE, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  TAG_CARRINHO,
  TAG_COMPROU,
  TAG_ULTIMO_CARRINHO,
  TAG_VALOR,
  TAG_VERSAO,
  tagsDaCompra,
  tagsDoApp,
  tagsDoCarrinho,
} from './tags.ts';

const AGORA = 1_800_000_000_000;

describe('tagsDoCarrinho', () => {
  it('marca contagem, valor e quando foi', () => {
    expect(tagsDoCarrinho({ count: 2, totalCents: 9900, quandoMs: AGORA })).toEqual({
      [TAG_CARRINHO]: '2',
      [TAG_VALOR]: '9900',
      [TAG_ULTIMO_CARRINHO]: '1800000000',
    });
  });

  it('a data vai em segundos, que é o que o filtro do OneSignal entende', () => {
    const tags = tagsDoCarrinho({ count: 1, quandoMs: AGORA });
    expect(tags[TAG_ULTIMO_CARRINHO]).toBe('1800000000');
    expect(tags[TAG_ULTIMO_CARRINHO]).not.toContain('-');
  });

  it('sem valor informado, o valor é zero e não some', () => {
    // Tag ausente e tag zerada segmentam diferente: a ausente nunca casa com
    // "cart_value < 5000", e o cliente some da campanha sem motivo.
    expect(tagsDoCarrinho({ count: 1, quandoMs: AGORA })[TAG_VALOR]).toBe('0');
  });

  /*
   * O caso que erra sozinho: o cliente esvazia o carrinho e o `cart_value`
   * fica em R$ 300. A campanha de "carrinho alto" passa a falar com quem não
   * tem carrinho nenhum.
   */
  it('carrinho vazio zera a contagem E o valor', () => {
    expect(tagsDoCarrinho({ count: 0, totalCents: 30_000, quandoMs: AGORA })).toEqual({
      [TAG_CARRINHO]: '0',
      [TAG_VALOR]: '0',
    });
  });

  /*
   * `last_cart_at` marca a última vez que HOUVE carrinho. Atualizar no
   * esvaziamento faria a segmentação de recuperação achar que o cliente
   * acabou de montar um carrinho.
   */
  it('carrinho vazio NÃO mexe na data do último carrinho', () => {
    expect(tagsDoCarrinho({ count: 0, quandoMs: AGORA })).not.toHaveProperty(TAG_ULTIMO_CARRINHO);
  });

  it('nunca escreve número quebrado nem negativo', () => {
    const tags = tagsDoCarrinho({ count: 2.7, totalCents: 10.9, quandoMs: AGORA });
    expect(tags[TAG_CARRINHO]).toBe('2');
    expect(tags[TAG_VALOR]).toBe('10');

    const estranho = tagsDoCarrinho({ count: -3, totalCents: -100, quandoMs: AGORA });
    expect(estranho[TAG_CARRINHO]).toBe('0');
    expect(estranho[TAG_VALOR]).toBe('0');
  });

  it('todos os valores são string, que é o que o OneSignal guarda', () => {
    for (const valor of Object.values(tagsDoCarrinho({ count: 3, quandoMs: AGORA }))) {
      expect(typeof valor).toBe('string');
    }
  });
});

describe('tagsDaCompra', () => {
  /*
   * Sem zerar o carrinho aqui, quem acaba de comprar continua marcado com
   * carrinho cheio — e entra na campanha de carrinho abandonado minutos
   * depois de pagar.
   */
  it('marca a compra e zera o carrinho junto', () => {
    expect(tagsDaCompra()).toEqual({
      [TAG_COMPROU]: 'true',
      [TAG_CARRINHO]: '0',
      [TAG_VALOR]: '0',
    });
  });
});

describe('tagsDoApp', () => {
  it('marca a versão instalada', () => {
    expect(tagsDoApp('1.4.2')).toEqual({ [TAG_VERSAO]: '1.4.2' });
  });
});

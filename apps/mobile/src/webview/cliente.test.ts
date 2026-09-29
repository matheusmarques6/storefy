/**
 * O script roda aqui, num contexto do `node:vm` com o `window` que a Shopify
 * monta — checar só a sintaxe não diria que mensagem chega ao app.
 */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { lerMensagemDaWeb } from '@storefy/bridge';
import { gerarIdentificacaoDoCliente } from './cliente';

function rodar(janela: Record<string, unknown>, comCanal = true): unknown[] {
  const mensagens: unknown[] = [];
  const global: Record<string, unknown> = { ...janela };
  if (comCanal) {
    global.ReactNativeWebView = {
      postMessage: (texto: string): void => {
        const lida = lerMensagemDaWeb(texto);
        if (!lida.ok) throw new Error(`o contrato recusou: ${lida.motivo}`);
        mensagens.push(lida.mensagem);
      },
    };
  }
  global.window = global;
  runInContext(gerarIdentificacaoDoCliente(), createContext(global));
  return mensagens;
}

describe('quem é o cliente', () => {
  it('lê o cliente logado de __st, que toda página da loja tem', () => {
    expect(rodar({ __st: { a: 5678, p: 'home', cid: 6_789_012_345 } })).toEqual([
      { type: 'CUSTOMER_IDENTIFIED', customerId: '6789012345' },
    ]);
  });

  it('cai no ShopifyAnalytics quando __st não traz o cliente', () => {
    expect(
      rodar({
        __st: { a: 5678, p: 'product' },
        ShopifyAnalytics: { meta: { page: { customerId: 42 } } },
      }),
    ).toEqual([{ type: 'CUSTOMER_IDENTIFIED', customerId: '42' }]);
  });

  it('sem cliente logado, não manda nada — nem "ninguém"', () => {
    // O checkout novo não tem esses objetos; mandar "ninguém" dali desligaria
    // a identificação no meio da compra.
    expect(rodar({ __st: { a: 5678, p: 'home' } })).toEqual([]);
    expect(rodar({})).toEqual([]);
  });

  it('não repassa o que não é id da Shopify', () => {
    expect(rodar({ __st: { cid: 'abc' } })).toEqual([]);
    expect(rodar({ __st: { cid: '' } })).toEqual([]);
    expect(rodar({ __st: { cid: -1 } })).toEqual([]);
    expect(rodar({ ShopifyAnalytics: { meta: { page: { customerId: { x: 1 } } } } })).toEqual([]);
  });

  it('fora do app, não quebra a página', () => {
    expect(() => rodar({ __st: { cid: 1 } }, false)).not.toThrow();
  });
});

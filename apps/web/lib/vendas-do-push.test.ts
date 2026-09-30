import { describe, expect, it } from 'vitest';
import { lerMetricas } from '@/lib/campanha';
import {
  AVISO_DAS_ABERTURAS,
  dicaDasVendas,
  funilDaAutomacao,
  funilDaCampanha,
  ticketMedio,
  MOTIVO_SEM_VENDAS,
  receitaDaCampanha,
  vendasVisiveis,
  textoDosPedidos,
} from '@/lib/vendas-do-push';

/** O espaço do `Intl` em "R$ 1.234,56" é o não separável. */
const reais = (texto: string): string => texto.replace(/\u00a0/g, ' ');

describe('vendasVisiveis', () => {
  it('só com a Shopify conectada a tela afirma quanto vendeu', () => {
    expect(vendasVisiveis({ platform: 'shopify', shopify_scopes: ['read_orders'] })).toBe(true);
    expect(vendasVisiveis({ platform: 'shopify', shopify_scopes: [] })).toBe(true);
    expect(vendasVisiveis({ platform: 'shopify', shopify_scopes: null })).toBe(false);
    expect(vendasVisiveis({ platform: 'other', shopify_scopes: null })).toBe(false);
  });
});

describe('receitaDaCampanha', () => {
  const vendas = { pedidos: 3, receitaCents: 123456 };

  it('campanha enviada mostra a receita, inclusive zero', () => {
    expect(reais(receitaDaCampanha('sent', vendas, true))).toBe('R$ 1.234,56');
    expect(reais(receitaDaCampanha('sent', { pedidos: 0, receitaCents: 0 }, true))).toBe('R$ 0,00');
  });

  /* Zero sem a Shopify diria que a campanha não vendeu, quando a Storefy só não vê. */
  it('sem a Shopify, ou antes de enviar, é traço', () => {
    expect(receitaDaCampanha('sent', vendas, false)).toBe('—');
    for (const status of ['draft', 'scheduled', 'sending', 'failed', 'canceled'] as const) {
      expect(receitaDaCampanha(status, vendas, true), status).toBe('—');
    }
    expect(receitaDaCampanha('sent', undefined, true)).toBe('—');
  });
});

describe('textoDosPedidos e ticketMedio', () => {
  it('fala como gente', () => {
    expect(textoDosPedidos(0)).toBe('nenhum pedido');
    expect(textoDosPedidos(1)).toBe('1 pedido');
    expect(textoDosPedidos(1234)).toBe('1.234 pedidos');
  });

  it('a legenda do topo diz a janela e de onde veio', () => {
    expect(dicaDasVendas({ pedidos: 0, receitaCents: 0 })).toBe(
      'Nenhum pedido nos últimos 30 dias veio de uma notificação.',
    );
    expect(dicaDasVendas({ pedidos: 2, receitaCents: 100 })).toBe(
      '2 pedidos nos últimos 30 dias, de quem tocou numa notificação.',
    );
  });

  it('ticket médio só existe com pedido', () => {
    expect(ticketMedio({ pedidos: 0, receitaCents: 0 })).toBeNull();
    expect(ticketMedio({ pedidos: 3, receitaCents: 10000 })).toBe(3333);
  });
});

describe('funilDaCampanha', () => {
  const metricas = lerMetricas({ enviados: 1000, entregues: 800, abertos: 40 });

  it('cada etapa leva a taxa da anterior e a barra é a fração do topo', () => {
    const funil = funilDaCampanha(metricas, { pedidos: 4, receitaCents: 50000 }, true);

    expect(funil.map((etapa) => [etapa.chave, etapa.valor, etapa.taxa, etapa.largura])).toEqual([
      ['enviados', 1000, null, 1],
      ['entregues', 800, 0.8, 0.8],
      ['aberturas', 40, 0.05, 0.04],
      ['pedidos', 4, 0.1, 0.004],
    ]);
  });

  it('sem a Shopify, pedidos é traço e diz por quê', () => {
    const pedidos = funilDaCampanha(metricas, { pedidos: 4, receitaCents: 1 }, false).at(-1);
    expect(pedidos).toMatchObject({ valor: null, taxa: null, largura: null });
    expect(pedidos?.explicacao).toBe(MOTIVO_SEM_VENDAS);
  });

  /* As estatísticas chegam horas depois: o funil não desenha o zero que não aconteceu. */
  it('antes das estatísticas, só o que já existe tem barra', () => {
    const funil = funilDaCampanha(
      lerMetricas({ enviados: 500 }),
      { pedidos: 0, receitaCents: 0 },
      true,
    );
    expect(funil.map((etapa) => etapa.valor)).toEqual([500, null, null, 0]);
    expect(funil.map((etapa) => etapa.largura)).toEqual([1, null, null, 0]);
    // Sem aberturas, a taxa dos pedidos não tem de onde sair.
    expect(funil.at(-1)?.taxa).toBeNull();
  });

  it('taxa acima de 100% não aparece', () => {
    const funil = funilDaCampanha(
      lerMetricas({ enviados: 10, entregues: 10, abertos: 2 }),
      { pedidos: 3, receitaCents: 1 },
      true,
    );
    expect(funil.at(-1)).toMatchObject({ valor: 3, taxa: null });
  });

  it('campanha sem nenhum número não tem topo nem barra', () => {
    const funil = funilDaCampanha(lerMetricas({}), undefined, true);
    expect(funil.every((etapa) => etapa.valor === null && etapa.largura === null)).toBe(true);
  });
});

describe('funilDaAutomacao', () => {
  const resultado = { envios: 200, aberturas: 50, pedidos: 5, receitaCents: 45_000 };

  it('enviadas → aberturas → pedidos, sem "entregues"', () => {
    const etapas = funilDaAutomacao(resultado, true, true);
    expect(etapas.map((etapa) => etapa.chave)).toEqual(['enviados', 'aberturas', 'pedidos']);
    expect(etapas.map((etapa) => etapa.valor)).toEqual([200, 50, 5]);
    expect(etapas[1]?.taxa).toBe(0.25);
    expect(etapas[2]?.taxa).toBe(0.1);
    expect(etapas[2]?.largura).toBe(5 / 200);
  });

  /* O app de antes não conta o toque: um zero ali diria que ninguém abre. */
  it('enquanto o app não conta as aberturas, a etapa fica com traço, e os pedidos sem taxa', () => {
    const etapas = funilDaAutomacao(resultado, false, true);
    expect(etapas[1]).toMatchObject({ valor: null, taxa: null, largura: null });
    expect(etapas[1]?.explicacao).toBe(AVISO_DAS_ABERTURAS);
    expect(etapas[2]).toMatchObject({ valor: 5, taxa: null });
  });

  it('sem a Shopify, os pedidos ficam com traço', () => {
    expect(funilDaAutomacao(resultado, true, false)[2]).toMatchObject({ valor: null });
  });

  it('nada enviado ainda: zeros de verdade, sem barra', () => {
    const etapas = funilDaAutomacao(
      { envios: 0, aberturas: 0, pedidos: 0, receitaCents: 0 },
      true,
      true,
    );
    expect(etapas.map((etapa) => etapa.valor)).toEqual([0, 0, 0]);
    expect(etapas.every((etapa) => etapa.largura === null && etapa.taxa === null)).toBe(true);
  });
});

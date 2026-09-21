import { describe, expect, it } from 'vitest';
import {
  ATRIBUTO_DO_CARRINHO,
  centavosDoPedido,
  origemDoPedido,
  variantesDisponiveis,
} from '@/lib/shopify-webhook';

describe('origemDoPedido', () => {
  const comAtributo = (valor: string): unknown => ({
    note_attributes: [{ name: ATRIBUTO_DO_CARRINHO, value: valor }],
  });

  /*
   * A marca vem do atributo que o app injetou no carrinho, e não de uma janela
   * de tempo. Uma heurística de "comprou até 30 minutos depois de abrir o app"
   * erraria toda vez que o cliente abre o app, desiste, e compra pelo site meia
   * hora depois — sempre a favor do app, que é o pior tipo de erro num número
   * que justifica a assinatura.
   */
  it('pedido com a marca do app conta como app', () => {
    expect(origemDoPedido(comAtributo('1'))).toBe('app');
    expect(origemDoPedido(comAtributo('true'))).toBe('app');
  });

  it('pedido sem a marca conta como site', () => {
    for (const pedido of [
      {},
      { note_attributes: [] },
      { note_attributes: [{ name: 'outro', value: '1' }] },
      comAtributo('0'),
      comAtributo(''),
      comAtributo('sim'),
      null,
      'texto',
    ]) {
      expect(origemDoPedido(pedido)).toBe('site');
    }
  });

  /** O atributo começa com `_`: a Shopify o esconde do cliente final. */
  it('o atributo é escondido do cliente final', () => {
    expect(ATRIBUTO_DO_CARRINHO.startsWith('_')).toBe(true);
  });

  it('payload torto não estoura', () => {
    for (const pedido of [
      { note_attributes: 'nao-e-lista' },
      { note_attributes: [null, 42, 'x'] },
      { note_attributes: [{ name: 1, value: 2 }] },
    ]) {
      expect(origemDoPedido(pedido)).toBe('site');
    }
  });

  /*
   * O atributo é escrito pelo NOSSO bridge, e ele escreve a string '1'. Um
   * número ali não veio de nós, e aceitá-lo por conversão deixaria um atributo
   * numérico qualquer da loja inflar a receita atribuída ao app — sempre a
   * favor do app, que é o erro que ninguém percebe.
   */
  it('o valor precisa ser a string que o bridge escreve, não um número', () => {
    expect(origemDoPedido({ note_attributes: [{ name: ATRIBUTO_DO_CARRINHO, value: 1 }] })).toBe(
      'site',
    );
    expect(origemDoPedido({ note_attributes: [{ name: ATRIBUTO_DO_CARRINHO, value: true }] })).toBe(
      'site',
    );
  });
});

describe('centavosDoPedido', () => {
  /*
   * A Shopify manda o total como TEXTO decimal. `Number("149.90") * 100`
   * devolve 14989.999999999998 para alguns valores, e o arredondamento errado
   * vira centavo faltando na receita do mês.
   */
  it('converte o texto decimal sem perder centavo', () => {
    expect(centavosDoPedido('149.90')).toBe(14990);
    expect(centavosDoPedido('0.10')).toBe(10);
    expect(centavosDoPedido('1.01')).toBe(101);
    expect(centavosDoPedido('19.99')).toBe(1999);
    expect(centavosDoPedido('100')).toBe(10000);
    expect(centavosDoPedido('0')).toBe(0);
  });

  /** Uma casa decimal só é `.9` = 90 centavos, não 9. */
  it('uma casa decimal vale dez centavos', () => {
    expect(centavosDoPedido('1.5')).toBe(150);
    expect(centavosDoPedido('0.9')).toBe(90);
  });

  /** Mais de duas casas: a Shopify não manda, mas se mandar, corta. */
  it('mais de duas casas é cortado, não arredondado para cima', () => {
    expect(centavosDoPedido('1.999')).toBe(199);
  });

  it('estorno vem negativo e continua negativo', () => {
    expect(centavosDoPedido('-50.00')).toBe(-5000);
  });

  it('número também funciona', () => {
    expect(centavosDoPedido(149.9)).toBe(14990);
  });

  /*
   * Valor que não dá para ler vira ZERO, nunca `NaN`. Um `NaN` somado na
   * receita do dia apagaria o número inteiro do painel.
   */
  it('o que não dá para ler vira zero, nunca NaN', () => {
    const ruins: [string, unknown][] = [
      ['vazio', ''],
      ['espaço', '  '],
      ['palavra', 'grátis'],
      ['com R$', 'R$ 10,00'],
      ['vírgula', '1,5'],
      ['null', null],
      ['undefined', undefined],
      ['objeto', {}],
      ['lista', []],
    ];

    for (const [nome, ruim] of ruins) {
      const resultado = centavosDoPedido(ruim);
      expect(resultado, nome).toBe(0);
      expect(Number.isNaN(resultado), nome).toBe(false);
    }
  });

  it('valor absurdo não vira número inseguro', () => {
    expect(centavosDoPedido('999999999999999999999')).toBe(0);
  });
});

/*
 * Os três webhooks de privacidade e o de desinstalação precisam funcionar
 * mesmo para uma loja que NÃO ESTÁ mais no nosso banco. Responder erro neles é
 * motivo de recusa na revisão da Shopify.
 */
describe('aplicarWebhook', () => {
  /** Um client falso que registra o que foi chamado. */
  function falso(appId: string | null = 'app-1', agendou = true, avisados = 2) {
    const chamadas: { nome: string; args: unknown }[] = [];
    const cliente = {
      rpc: (nome: string, args: unknown) => {
        chamadas.push({ nome, args });
        if (nome === 'app_da_loja_shopify') {
          return Promise.resolve({
            data: appId === null ? [] : [{ app_id: appId, store_id: 'loja', timezone: 'UTC' }],
            error: null,
          });
        }
        if (nome === 'apagar_dados_da_shopify') {
          return Promise.resolve({ data: 7, error: null });
        }
        if (nome === 'agendar_pedido_enviado') {
          return Promise.resolve({ data: agendou, error: null });
        }
        if (nome === 'avisar_de_volta') {
          return Promise.resolve({ data: avisados, error: null });
        }
        return Promise.resolve({ data: true, error: null });
      },
    };
    return { cliente, chamadas };
  }

  it('shop/redact apaga os dados mesmo sem loja no banco', async () => {
    const { aplicarWebhook } = await import('@/lib/shopify-webhook');
    const { cliente, chamadas } = falso(null);

    const r = await aplicarWebhook(cliente as never, 'shop/redact', 'x.myshopify.com', '{}');

    expect(r.feito).toBe('apagados:7');
    expect(chamadas[0]?.nome).toBe('apagar_dados_da_shopify');
  });

  it('app/uninstalled apaga o token da loja', async () => {
    const { aplicarWebhook } = await import('@/lib/shopify-webhook');
    const { cliente, chamadas } = falso();

    const r = await aplicarWebhook(cliente as never, 'app/uninstalled', 'x.myshopify.com', '{}');

    expect(r.feito).toBe('desconectada');
    expect(chamadas[0]?.nome).toBe('desconectar_shopify');
  });

  /*
   * A Storefy não guarda dado de cliente final da loja: cadastro, endereço e
   * pagamento ficam na Shopify. Responder 200 sem fazer nada é a resposta
   * CORRETA, e não preguiça — apagar um "cliente" que não existe seria
   * inventar trabalho.
   */
  it('os webhooks de cliente respondem sem tocar no banco', async () => {
    const { aplicarWebhook } = await import('@/lib/shopify-webhook');

    for (const topico of ['customers/data_request', 'customers/redact'] as const) {
      const { cliente, chamadas } = falso();
      const r = await aplicarWebhook(cliente as never, topico, 'x.myshopify.com', '{}');
      expect(r.feito).toBe('sem_dado_de_cliente');
      expect(chamadas).toEqual([]);
    }
  });

  it('loja desconhecida não vira erro', async () => {
    const { aplicarWebhook } = await import('@/lib/shopify-webhook');
    const { cliente } = falso(null);

    const r = await aplicarWebhook(cliente as never, 'orders/create', 'x.myshopify.com', '{}');
    expect(r.feito).toBe('loja_desconhecida');
  });

  it('pedido é gravado com origem, total e token do carrinho', async () => {
    const { aplicarWebhook } = await import('@/lib/shopify-webhook');
    const { cliente, chamadas } = falso();

    const pedido = JSON.stringify({
      id: 12345,
      name: '#1001',
      total_price: '149.90',
      currency: 'BRL',
      cart_token: 'token-abc',
      created_at: '2026-09-19T12:00:00-03:00',
      note_attributes: [{ name: ATRIBUTO_DO_CARRINHO, value: '1' }],
    });

    const r = await aplicarWebhook(cliente as never, 'orders/create', 'x.myshopify.com', pedido);

    expect(r).toEqual({ feito: 'pedido', novo: true });
    expect(chamadas.find((c) => c.nome === 'registrar_pedido')?.args).toEqual({
      p_app_id: 'app-1',
      p_shopify_order_id: '12345',
      p_source: 'app',
      p_total_cents: 14990,
      p_ordered_at: '2026-09-19T12:00:00-03:00',
      p_order_number: '#1001',
      p_currency: 'BRL',
      p_cart_token: 'token-abc',
    });
  });

  it('pedido sem id ou com JSON quebrado não estoura', async () => {
    const { aplicarWebhook } = await import('@/lib/shopify-webhook');

    for (const corpo of ['{isto não é json', '{}', 'null']) {
      const { cliente, chamadas } = falso();
      const r = await aplicarWebhook(cliente as never, 'orders/create', 'x.myshopify.com', corpo);
      expect(['corpo_invalido', 'sem_id']).toContain(r.feito);
      expect(chamadas.some((c) => c.nome === 'registrar_pedido')).toBe(false);
    }
  });

  /*
   * O webhook de remessa avisa o aparelho QUE FEZ O PEDIDO. Sem esse elo,
   * "seu pedido saiu para entrega" iria para a loja inteira — spam, e motivo
   * de desinstalação.
   */
  it('remessa agenda o aviso pelo id do pedido', async () => {
    const { aplicarWebhook } = await import('@/lib/shopify-webhook');
    const { cliente, chamadas } = falso();

    const remessa = JSON.stringify({ id: 999, order_id: 12345, status: 'success' });
    const r = await aplicarWebhook(
      cliente as never,
      'fulfillments/create',
      'x.myshopify.com',
      remessa,
    );

    expect(r.feito).toBe('envio_avisado');
    expect(chamadas.find((c) => c.nome === 'agendar_pedido_enviado')?.args).toEqual({
      p_app_id: 'app-1',
      p_shopify_order_id: '12345',
    });
  });

  /*
   * Pedido do SITE não tem aparelho para avisar. O banco devolve `false`, e a
   * rota diz que não avisou — em vez de fingir que avisou alguém.
   */
  it('remessa de pedido sem aparelho não vira aviso', async () => {
    const { aplicarWebhook } = await import('@/lib/shopify-webhook');
    const { cliente } = falso('app-1', false);

    const r = await aplicarWebhook(
      cliente as never,
      'fulfillments/create',
      'x.myshopify.com',
      JSON.stringify({ order_id: 42 }),
    );

    expect(r.feito).toBe('envio_sem_aviso');
  });

  it('remessa sem pedido ou com JSON quebrado não estoura', async () => {
    const { aplicarWebhook } = await import('@/lib/shopify-webhook');

    for (const corpo of ['{isto não é json', '{}', 'null', '{"order_id": null}']) {
      const { cliente, chamadas } = falso();
      const r = await aplicarWebhook(
        cliente as never,
        'fulfillments/create',
        'x.myshopify.com',
        corpo,
      );
      expect(['corpo_invalido', 'sem_pedido']).toContain(r.feito);
      expect(chamadas.some((c) => c.nome === 'agendar_pedido_enviado')).toBe(false);
    }
  });

  it('produto que voltou avisa quem pediu, variante por variante', async () => {
    const { aplicarWebhook } = await import('@/lib/shopify-webhook');
    const { cliente, chamadas } = falso();

    const produto = JSON.stringify({
      id: 77,
      variants: [
        { id: 111, inventory_quantity: 3, inventory_management: 'shopify' },
        { id: 222, inventory_quantity: 0, inventory_management: 'shopify' },
        { id: 333, inventory_quantity: 5, inventory_management: 'shopify' },
      ],
    });

    const r = await aplicarWebhook(cliente as never, 'products/update', 'x.myshopify.com', produto);

    expect(r.feito).toBe('de_volta:4');
    expect(chamadas.filter((c) => c.nome === 'avisar_de_volta').map((c) => c.args)).toEqual([
      { p_app_id: 'app-1', p_variant_id: '111' },
      { p_app_id: 'app-1', p_variant_id: '333' },
    ]);
  });

  it('produto todo esgotado não chama o banco', async () => {
    const { aplicarWebhook } = await import('@/lib/shopify-webhook');
    const { cliente, chamadas } = falso();

    const produto = JSON.stringify({
      variants: [{ id: 1, inventory_quantity: 0, inventory_management: 'shopify' }],
    });

    const r = await aplicarWebhook(cliente as never, 'products/update', 'x.myshopify.com', produto);

    expect(r.feito).toBe('sem_variante_disponivel');
    expect(chamadas.some((c) => c.nome === 'avisar_de_volta')).toBe(false);
  });
});

describe('variantesDisponiveis', () => {
  /*
   * `inventory_quantity > 0` NÃO basta. A loja que vende sem controlar estoque
   * tem `inventory_management: null` e quantidade zero — e está disponível. Só
   * olhar a quantidade deixaria essas lojas sem nunca avisar ninguém.
   */
  it('variante sem controle de estoque está sempre disponível', () => {
    expect(
      variantesDisponiveis({
        variants: [{ id: 1, inventory_quantity: 0, inventory_management: null }],
      }),
    ).toEqual(['1']);
  });

  it('e a que vende mesmo esgotada também', () => {
    expect(
      variantesDisponiveis({
        variants: [
          {
            id: 2,
            inventory_quantity: 0,
            inventory_management: 'shopify',
            inventory_policy: 'continue',
          },
        ],
      }),
    ).toEqual(['2']);
  });

  it('a esgotada de verdade fica de fora', () => {
    expect(
      variantesDisponiveis({
        variants: [
          {
            id: 3,
            inventory_quantity: 0,
            inventory_management: 'shopify',
            inventory_policy: 'deny',
          },
        ],
      }),
    ).toEqual([]);
  });

  it('e a quantidade negativa também: estoque negativo é esgotado', () => {
    expect(
      variantesDisponiveis({
        variants: [{ id: 4, inventory_quantity: -2, inventory_management: 'shopify' }],
      }),
    ).toEqual([]);
  });

  it('payload torto não estoura', () => {
    for (const produto of [
      null,
      'texto',
      {},
      { variants: 'não é lista' },
      { variants: [null, 42, {}] },
    ]) {
      expect(variantesDisponiveis(produto), JSON.stringify(produto)).toEqual([]);
    }
  });
});

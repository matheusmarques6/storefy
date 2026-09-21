import { describe, expect, it } from 'vitest';
import { ATRIBUTO_DO_APP, centavosDoPedido, origemDoPedido } from '@/lib/shopify-webhook';

describe('origemDoPedido', () => {
  const comAtributo = (valor: string): unknown => ({
    note_attributes: [{ name: ATRIBUTO_DO_APP, value: valor }],
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
    expect(ATRIBUTO_DO_APP.startsWith('_')).toBe(true);
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
    expect(origemDoPedido({ note_attributes: [{ name: ATRIBUTO_DO_APP, value: 1 }] })).toBe('site');
    expect(origemDoPedido({ note_attributes: [{ name: ATRIBUTO_DO_APP, value: true }] })).toBe(
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
  function falso(appId: string | null = 'app-1') {
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
      note_attributes: [{ name: ATRIBUTO_DO_APP, value: '1' }],
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
   * Os dois tópicos que ainda não têm automação são ACEITOS, e não recusados:
   * uma cadeia de 4xx faz a Shopify DESATIVAR o webhook da loja, e registrá-lo
   * de novo exigiria reinstalar o app.
   */
  it('os tópicos ainda sem automação são aceitos, não recusados', async () => {
    const { aplicarWebhook } = await import('@/lib/shopify-webhook');

    for (const topico of ['fulfillments/create', 'products/update'] as const) {
      const { cliente } = falso();
      const r = await aplicarWebhook(cliente as never, topico, 'x.myshopify.com', '{}');
      expect(r.feito).toBe(`aceito:${topico}`);
    }
  });
});

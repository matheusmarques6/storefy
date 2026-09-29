import { describe, expect, it } from 'vitest';
import {
  CorpoDoWebhook,
  MAXIMO_DE_CLIENTES,
  PREFIXO_DA_CHAVE,
  buscaPeloEmail,
  chaveDoPedido,
  clientesDoCorpo,
  dicaDaChave,
  gerarChave,
  hashDaChave,
  idDoCliente,
} from '@/lib/webhook-de-automacao';

describe('idDoCliente', () => {
  it('aceita o gid da Shopify, o número e o texto — e devolve como o app grava', () => {
    expect(idDoCliente('gid://shopify/Customer/7208822145')).toBe('7208822145');
    expect(idDoCliente(7208822145)).toBe('7208822145');
    expect(idDoCliente('7208822145')).toBe('7208822145');
    expect(idDoCliente('  7208822145 ')).toBe('7208822145');
  });

  it('o que não é id de cliente fica de fora', () => {
    for (const ruim of [
      'gid://shopify/Order/123',
      'gid://shopify/Customer/abc',
      'cliente-123',
      '12a',
      '-5',
      1.5,
      '',
      null,
      undefined,
      { id: 1 },
      '1'.repeat(21),
    ]) {
      expect(idDoCliente(ruim)).toBeNull();
    }
  });
});

describe('buscaPeloEmail', () => {
  it('põe o e-mail entre aspas na sintaxe da busca da Shopify', () => {
    expect(buscaPeloEmail(' cliente@loja.com.br ')).toBe('email:"cliente@loja.com.br"');
  });

  it('aspas e barras não fecham a busca antes da hora', () => {
    expect(buscaPeloEmail('a"b\\c@loja.com')).toBe('email:"abc@loja.com"');
  });
});

describe('a chave', () => {
  it('tem o prefixo, 32 bytes aleatórios e passa na conferência do pedido', () => {
    const chave = gerarChave();
    expect(chave.startsWith(PREFIXO_DA_CHAVE)).toBe(true);
    expect(chave).toHaveLength(PREFIXO_DA_CHAVE.length + 43);
    expect(chaveDoPedido(`Bearer ${chave}`, null)).toBe(chave);
  });

  it('nunca repete', () => {
    const chaves = new Set(Array.from({ length: 200 }, () => gerarChave()));
    expect(chaves.size).toBe(200);
  });

  it('o hash é sha256 em hexadecimal, o mesmo para a mesma chave', () => {
    const chave = gerarChave();
    expect(hashDaChave(chave)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDaChave(chave)).toBe(hashDaChave(chave));
    expect(hashDaChave(chave)).not.toBe(hashDaChave(gerarChave()));
  });

  it('a dica são os 4 últimos caracteres — o bastante para reconhecer, pouco para adivinhar', () => {
    const chave = gerarChave();
    expect(dicaDaChave(chave)).toBe(chave.slice(-4));
    expect(dicaDaChave(chave)).toHaveLength(4);
  });
});

describe('chaveDoPedido', () => {
  const chave = gerarChave();

  it('lê do cabeçalho Authorization, em qualquer caixa', () => {
    expect(chaveDoPedido(`Bearer ${chave}`, null)).toBe(chave);
    expect(chaveDoPedido(`bearer   ${chave}  `, null)).toBe(chave);
  });

  it('ou de ?token=, para a ferramenta que não deixa pôr cabeçalho', () => {
    expect(chaveDoPedido(null, chave)).toBe(chave);
    expect(chaveDoPedido('Basic dXNlcjpzZW5oYQ==', chave)).toBe(chave);
  });

  it('o cabeçalho vence o parâmetro', () => {
    const outra = gerarChave();
    expect(chaveDoPedido(`Bearer ${chave}`, outra)).toBe(chave);
  });

  it('fora do formato é nula e nem chega ao banco', () => {
    for (const [cabecalho, token] of [
      [null, null],
      ['Bearer', null],
      [`Bearer ${chave.slice(0, -1)}`, null],
      [`Bearer ${chave}x`, null],
      [`Bearer ${chave.replace(PREFIXO_DA_CHAVE, 'sk_live_')}`, null],
      [`Bearer ${chave} outra-coisa`, null],
      [null, `${chave}"; drop table`],
    ] as const) {
      expect(chaveDoPedido(cabecalho, token)).toBeNull();
    }
  });
});

describe('CorpoDoWebhook', () => {
  it('aceita o id do cliente, a lista ou o e-mail', () => {
    expect(CorpoDoWebhook.safeParse({ customerId: '123' }).success).toBe(true);
    expect(CorpoDoWebhook.safeParse({ customerId: 123 }).success).toBe(true);
    expect(CorpoDoWebhook.safeParse({ customerIds: ['1', 2] }).success).toBe(true);
    expect(CorpoDoWebhook.safeParse({ email: 'cliente@loja.com.br' }).success).toBe(true);
  });

  it('sem dizer quem recebe, recusa — e diz o que falta', () => {
    for (const corpo of [{}, { customerIds: [] }, { title: 'Oi' }]) {
      const lido = CorpoDoWebhook.safeParse(corpo);
      expect(lido.success).toBe(false);
      expect(lido.error?.issues[0]?.message).toBe(
        'Diga quem recebe: customerId, customerIds ou email.',
      );
    }
  });

  it('recusa o id que não é de cliente da Shopify, dizendo o formato', () => {
    for (const corpo of [
      { customerId: 'cliente-123' },
      { customerId: '' },
      { customerIds: ['1', 'gid://shopify/Order/2'] },
    ]) {
      const lido = CorpoDoWebhook.safeParse(corpo);
      expect(lido.success).toBe(false);
      expect(lido.error?.issues[0]?.message).toBe(
        'Use o id do cliente na Shopify: só números, ou o gid://shopify/Customer/….',
      );
    }
  });

  it('recusa e-mail inválido, texto longo demais e lista grande demais', () => {
    expect(CorpoDoWebhook.safeParse({ email: 'nao-e-email' }).success).toBe(false);
    expect(CorpoDoWebhook.safeParse({ customerId: '1', title: 'x'.repeat(121) }).success).toBe(
      false,
    );
    expect(CorpoDoWebhook.safeParse({ customerId: '1', body: 'x'.repeat(401) }).success).toBe(
      false,
    );
    expect(
      CorpoDoWebhook.safeParse({
        customerIds: Array.from({ length: MAXIMO_DE_CLIENTES + 1 }, (_, i) => String(i + 1)),
      }).success,
    ).toBe(false);
  });

  it('título e texto em branco não valem como texto', () => {
    expect(CorpoDoWebhook.safeParse({ customerId: '1', title: '   ' }).success).toBe(false);
    const lido = CorpoDoWebhook.safeParse({ customerId: '1', title: '  Oi  ', body: ' Tudo? ' });
    expect(lido.data?.title).toBe('Oi');
    expect(lido.data?.body).toBe('Tudo?');
  });

  it('o id do evento pode ser texto ou número', () => {
    expect(CorpoDoWebhook.safeParse({ customerId: '1', id: 'evt_01' }).success).toBe(true);
    expect(CorpoDoWebhook.safeParse({ customerId: '1', id: 42 }).success).toBe(true);
    expect(CorpoDoWebhook.safeParse({ customerId: '1', id: 'x'.repeat(101) }).success).toBe(false);
  });
});

describe('clientesDoCorpo', () => {
  it('junta o id e a lista, no formato do app, sem repetir', () => {
    expect(
      clientesDoCorpo({
        customerId: 'gid://shopify/Customer/10',
        customerIds: [10, '11', 'gid://shopify/Customer/12', 'lixo'],
      }),
    ).toEqual(['10', '11', '12']);
  });

  it('só com e-mail, nenhum id', () => {
    expect(clientesDoCorpo({ email: 'cliente@loja.com.br' })).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  URL_DA_ASAAS,
  cancelarAssinatura,
  cobrancaConfigurada,
  configuracaoDaAsaas,
  criarAssinatura,
  criarCliente,
  faturaDaAsaas,
  faturasDaAssinatura,
  motivoDaRecusa,
  mudarValorDaAssinatura,
  tokenDoWebhook,
} from '@/lib/asaas';

const ORIGINAIS = {
  chave: process.env.ASAAS_API_KEY,
  url: process.env.ASAAS_API_URL,
  token: process.env.ASAAS_WEBHOOK_TOKEN,
};

function restaurar(
  nome: 'ASAAS_API_KEY' | 'ASAAS_API_URL' | 'ASAAS_WEBHOOK_TOKEN',
  valor: string | undefined,
) {
  if (valor === undefined) Reflect.deleteProperty(process.env, nome);
  else process.env[nome] = valor;
}

beforeEach(() => {
  process.env.ASAAS_API_KEY = '$aact_chave_de_teste';
  delete process.env.ASAAS_API_URL;
  process.env.ASAAS_WEBHOOK_TOKEN = 'token-do-webhook-com-folga';
});

afterEach(() => {
  restaurar('ASAAS_API_KEY', ORIGINAIS.chave);
  restaurar('ASAAS_API_URL', ORIGINAIS.url);
  restaurar('ASAAS_WEBHOOK_TOKEN', ORIGINAIS.token);
});

interface Pedido {
  url: string;
  metodo: string;
  cabecalhos: Record<string, string>;
  corpo: unknown;
}

/** Um `fetch` que anota o pedido e responde o combinado. */
function asaasQueResponde(status: number, resposta: unknown) {
  const pedidos: Pedido[] = [];
  const buscador = ((entrada: string | URL | Request, opcoes?: RequestInit) => {
    pedidos.push({
      url: entrada instanceof Request ? entrada.url : entrada.toString(),
      metodo: opcoes?.method ?? 'GET',
      cabecalhos: (opcoes?.headers ?? {}) as Record<string, string>,
      corpo: typeof opcoes?.body === 'string' ? JSON.parse(opcoes.body) : undefined,
    });
    return Promise.resolve(
      new Response(resposta === null ? '' : JSON.stringify(resposta), { status }),
    );
  }) as typeof fetch;
  return { pedidos, buscador };
}

describe('configuração', () => {
  it('sem chave, a cobrança não está ligada e diz o que falta', () => {
    delete process.env.ASAAS_API_KEY;
    expect(cobrancaConfigurada()).toBe(false);
    expect(configuracaoDaAsaas()).toEqual({ ok: false, falta: 'ASAAS_API_KEY' });
  });

  it('usa a Asaas de produção, a não ser que outra URL seja dada', () => {
    expect(configuracaoDaAsaas()).toMatchObject({ ok: true, url: URL_DA_ASAAS });
    process.env.ASAAS_API_URL = 'https://api-sandbox.asaas.com/v3/';
    expect(configuracaoDaAsaas()).toMatchObject({ url: 'https://api-sandbox.asaas.com/v3' });
  });

  it('a chave nunca viaja sem HTTPS, fora da própria máquina', () => {
    process.env.ASAAS_API_URL = 'http://api.asaas.com/v3';
    expect(configuracaoDaAsaas().ok).toBe(false);
    process.env.ASAAS_API_URL = 'http://127.0.0.1:4010/v3';
    expect(configuracaoDaAsaas().ok).toBe(true);
    process.env.ASAAS_API_URL = 'http://127.0.0.1.exemplo.com/v3';
    expect(configuracaoDaAsaas().ok).toBe(false);
  });

  it('o token do aviso precisa de folga para não ser adivinhado', () => {
    expect(tokenDoWebhook()).toBe('token-do-webhook-com-folga');
    process.env.ASAAS_WEBHOOK_TOKEN = 'curto';
    expect(tokenDoWebhook()).toBeNull();
  });
});

describe('o que vai para a Asaas', () => {
  it('cliente: nome, documento, e-mail e a empresa como referência, com a chave no cabeçalho', async () => {
    const { pedidos, buscador } = asaasQueResponde(200, { id: 'cus_123' });
    const resposta = await criarCliente(
      { nome: 'Loja Aurora', documento: '11222333000181', email: 'fin@aurora.com', orgId: 'org-1' },
      buscador,
    );
    expect(resposta).toEqual({ ok: true, dados: { id: 'cus_123' } });
    expect(pedidos[0]?.url).toBe(`${URL_DA_ASAAS}/customers`);
    expect(pedidos[0]?.metodo).toBe('POST');
    expect(pedidos[0]?.cabecalhos.access_token).toBe('$aact_chave_de_teste');
    expect(pedidos[0]?.corpo).toMatchObject({
      name: 'Loja Aurora',
      cpfCnpj: '11222333000181',
      email: 'fin@aurora.com',
      externalReference: 'org-1',
    });
  });

  it('assinatura mensal, em reais, com a forma de pagamento escolhida por quem paga', async () => {
    const { pedidos, buscador } = asaasQueResponde(200, { id: 'sub_9' });
    const resposta = await criarAssinatura(
      {
        cliente: 'cus_123',
        valorCentavos: 9990,
        primeiroVencimento: '2026-10-13',
        descricao: 'Storefy — plano Essencial',
        orgId: 'org-1',
      },
      buscador,
    );
    expect(resposta).toEqual({ ok: true, dados: { id: 'sub_9' } });
    expect(pedidos[0]?.corpo).toEqual({
      customer: 'cus_123',
      billingType: 'UNDEFINED',
      value: 99.9,
      nextDueDate: '2026-10-13',
      cycle: 'MONTHLY',
      description: 'Storefy — plano Essencial',
      externalReference: 'org-1',
    });
  });

  it('trocar de plano atualiza também a fatura aberta', async () => {
    const { pedidos, buscador } = asaasQueResponde(200, { id: 'sub_9' });
    await mudarValorDaAssinatura('sub_9', 19900, 'Storefy — plano Grande', buscador);
    expect(pedidos[0]?.metodo).toBe('PUT');
    expect(pedidos[0]?.url).toBe(`${URL_DA_ASAAS}/subscriptions/sub_9`);
    expect(pedidos[0]?.corpo).toEqual({
      value: 199,
      description: 'Storefy — plano Grande',
      updatePendingPayments: true,
    });
  });

  it('cancelar: já cancelada na Asaas conta como feito', async () => {
    const naoAchou = asaasQueResponde(404, { errors: [{ code: 'not_found', description: 'x' }] });
    expect(await cancelarAssinatura('sub_9', naoAchou.buscador)).toEqual({ ok: true, dados: null });
    expect(naoAchou.pedidos[0]?.metodo).toBe('DELETE');

    const caiu = asaasQueResponde(503, null);
    expect((await cancelarAssinatura('sub_9', caiu.buscador)).ok).toBe(false);
  });

  it('as faturas vêm da lista da assinatura, e linha torta fica de fora', async () => {
    const { pedidos, buscador } = asaasQueResponde(200, {
      data: [
        {
          id: 'pay_1',
          value: 99.9,
          status: 'PENDING',
          dueDate: '2026-10-13',
          invoiceUrl: 'https://x/i/1',
        },
        { id: 'pay_2' },
      ],
    });
    const resposta = await faturasDaAssinatura('sub_9', buscador);
    // A página inteira (100, o máximo): a padrão, de 10, esconderia as novas.
    expect(pedidos[0]?.url).toBe(`${URL_DA_ASAAS}/subscriptions/sub_9/payments?limit=100`);
    expect(resposta.ok && resposta.dados).toEqual([
      {
        id: 'pay_1',
        value: 99.9,
        status: 'PENDING',
        dueDate: '2026-10-13',
        invoiceUrl: 'https://x/i/1',
        clientPaymentDate: null,
        paymentDate: null,
        deleted: false,
      },
    ]);
  });

  /*
   * A fatura aberta que a lista não trouxe (removida, ou numa página que não
   * foi lida) é lida pelo id. 404 é "não existe mais", e não uma falha: é o
   * que fecha a fatura cujo aviso de remoção se perdeu.
   */
  it('uma fatura pelo id; a que a Asaas não tem mais volta vazia, e não como falha', async () => {
    const achou = asaasQueResponde(200, {
      id: 'pay_7',
      value: 49,
      status: 'RECEIVED',
      dueDate: '2026-09-13',
      paymentDate: '2026-09-15',
      deleted: false,
    });
    const lida = await faturaDaAsaas('pay_7', achou.buscador);
    expect(achou.pedidos[0]?.url).toBe(`${URL_DA_ASAAS}/payments/pay_7`);
    expect(lida.ok && lida.dados).toMatchObject({
      id: 'pay_7',
      status: 'RECEIVED',
      paymentDate: '2026-09-15',
      deleted: false,
    });

    const sumiu = asaasQueResponde(404, { errors: [{ code: 'not_found', description: 'x' }] });
    expect(await faturaDaAsaas('pay_7', sumiu.buscador)).toEqual({ ok: true, dados: null });

    const caiu = asaasQueResponde(503, null);
    expect((await faturaDaAsaas('pay_7', caiu.buscador)).ok).toBe(false);

    const torta = asaasQueResponde(200, { id: 'pay_7' });
    expect((await faturaDaAsaas('pay_7', torta.buscador)).ok).toBe(false);
  });

  it('sem chave, nada sai para a rede', async () => {
    delete process.env.ASAAS_API_KEY;
    const { pedidos, buscador } = asaasQueResponde(200, { id: 'cus_1' });
    const resposta = await criarCliente(
      { nome: 'X', documento: '1', email: 'a@b.c', orgId: 'o' },
      buscador,
    );
    expect(resposta.ok).toBe(false);
    expect(pedidos).toHaveLength(0);
  });
});

describe('recusas', () => {
  it('o 400 da Asaas fala do que a pessoa digitou, e atravessa', () => {
    expect(
      motivoDaRecusa(400, {
        errors: [{ code: 'invalid_cpfCnpj', description: 'O CPF/CNPJ informado é inválido.' }],
      }),
    ).toBe('O CPF/CNPJ informado é inválido.');
  });

  it('chave recusada e queda viram frase nossa', () => {
    expect(motivoDaRecusa(401, null)).toContain('recusou a nossa chave');
    expect(motivoDaRecusa(500, { errors: [{ description: 'NullPointerException' }] })).toBe(
      'Não conseguimos falar com o sistema de cobrança agora. Tente de novo em instantes.',
    );
  });

  it('resposta sem id não vira sucesso', async () => {
    const { buscador } = asaasQueResponde(200, {});
    expect(
      (await criarCliente({ nome: 'X', documento: '1', email: 'a@b.c', orgId: 'o' }, buscador)).ok,
    ).toBe(false);
  });
});

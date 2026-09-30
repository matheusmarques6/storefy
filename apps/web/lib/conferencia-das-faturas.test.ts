/**
 * A conferência das faturas direto na Asaas: o que ela lê, o que grava e o
 * que conta. O `registrar_fatura` (nunca desfaz uma paga) está provado no
 * `rls.test.sql`; aqui se prova a LIGAÇÃO — a fatura cujo aviso se perdeu
 * chega ao banco, e a removida na Asaas deixa de travar a empresa.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { conferirFaturas } from '@/lib/conferencia-das-faturas';

const ASSINATURA = 'sub_e2e_1';

interface NossaFatura {
  external_id: string;
  status: string;
  valor_centavos: number;
  vencimento: string;
}

let nossas: NossaFatura[] = [];
let erroDasNossas: { message: string } | null = null;
let gravacoes: Record<string, unknown>[] = [];
let recusarGravacao: (args: Record<string, unknown>) => boolean = () => false;
let marcas: Record<string, unknown>[] = [];

/** O client da service role, só com o que a conferência usa. */
function banco(): SupabaseClient<Database> {
  const cliente = {
    from: (tabela: string) => {
      const cadeia: Record<string, unknown> = {};
      let valores: Record<string, unknown> | null = null;
      Object.assign(cadeia, {
        select: () => cadeia,
        update: (novos: Record<string, unknown>) => {
          valores = novos;
          return cadeia;
        },
        eq: () => cadeia,
        then: (aceitar: (v: unknown) => unknown) => {
          if (tabela === 'invoices') return aceitar({ data: nossas, error: erroDasNossas });
          if (valores !== null) marcas.push(valores);
          return aceitar({ data: null, error: null });
        },
      });
      return cadeia;
    },
    rpc: (_nome: string, args: Record<string, unknown>) => {
      gravacoes.push(args);
      return Promise.resolve(
        recusarGravacao(args)
          ? { data: null, error: { message: 'banco fora' } }
          : { data: 'aplicado', error: null },
      );
    },
  };
  return cliente as unknown as SupabaseClient<Database>;
}

/** A Asaas, pelas duas rotas que a conferência lê. */
function asaas(lista: unknown[], avulsas: Record<string, unknown> = {}, status = 200) {
  const pedidos: string[] = [];
  const buscador = ((entrada: string | URL | Request) => {
    const url = entrada instanceof Request ? entrada.url : entrada.toString();
    pedidos.push(url);
    if (status !== 200) return Promise.resolve(new Response('', { status }));
    if (new URL(url).pathname.endsWith(`/subscriptions/${ASSINATURA}/payments`)) {
      return Promise.resolve(new Response(JSON.stringify({ data: lista }), { status: 200 }));
    }
    const avulsa = /\/payments\/([^/]+)$/.exec(url)?.[1] ?? '';
    const achada = avulsas[avulsa];
    return Promise.resolve(
      achada == null
        ? new Response(JSON.stringify({ errors: [{ code: 'not_found' }] }), { status: 404 })
        : new Response(JSON.stringify(achada), { status: 200 }),
    );
  }) as typeof fetch;
  return { pedidos, buscador };
}

const PAGA = {
  id: 'pay_1',
  value: 99.9,
  status: 'RECEIVED',
  dueDate: '2026-09-13',
  invoiceUrl: 'https://sandbox.asaas.com/i/pay_1',
  clientPaymentDate: '2026-09-15',
  paymentDate: '2026-09-16',
};

let chaveOriginal: string | undefined;
let espioes: MockInstance[] = [];

beforeEach(() => {
  chaveOriginal = process.env.ASAAS_API_KEY;
  process.env.ASAAS_API_KEY = '$aact_chave_de_teste';
  nossas = [];
  erroDasNossas = null;
  gravacoes = [];
  recusarGravacao = () => false;
  marcas = [];
  espioes = [
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  if (chaveOriginal === undefined) delete process.env.ASAAS_API_KEY;
  else process.env.ASAAS_API_KEY = chaveOriginal;
  for (const espiao of espioes) espiao.mockRestore();
});

describe('conferirFaturas', () => {
  /* O defeito: o aviso do pagamento se perdeu, e quem pagou seria travado. */
  it('a fatura vencida aqui e paga na Asaas é gravada como paga, com a data', async () => {
    nossas = [
      { external_id: 'pay_1', status: 'overdue', valor_centavos: 9990, vencimento: '2026-09-13' },
    ];
    const { buscador } = asaas([PAGA]);

    const resultado = await conferirFaturas(banco(), ASSINATURA, buscador);

    expect(resultado).toMatchObject({ ok: true, pagasAgora: 1, naoGravadas: 0 });
    expect(gravacoes).toEqual([
      {
        p_provider: 'asaas',
        p_fatura: 'pay_1',
        p_assinatura: ASSINATURA,
        p_valor_centavos: 9990,
        p_status: 'paid',
        p_vencimento: '2026-09-13',
        p_paga_em: '2026-09-15',
        p_link: 'https://sandbox.asaas.com/i/pay_1',
      },
    ]);
    // E a assinatura sai do começo da fila do job.
    expect(marcas).toHaveLength(1);
    expect(marcas[0]).toHaveProperty('conferida_em');
  });

  it('a fatura nova, cujo aviso não chegou, aparece; e já paga aqui não conta de novo', async () => {
    nossas = [
      { external_id: 'pay_1', status: 'paid', valor_centavos: 9990, vencimento: '2026-09-13' },
    ];
    const nova = { ...PAGA, id: 'pay_2', status: 'PENDING', dueDate: '2026-10-13' };
    const { buscador } = asaas([nova, PAGA]);

    const resultado = await conferirFaturas(banco(), ASSINATURA, buscador);

    expect(resultado).toMatchObject({ ok: true, pagasAgora: 0 });
    expect(gravacoes.map((g) => [g.p_fatura, g.p_status])).toEqual([
      ['pay_2', 'pending'],
      ['pay_1', 'paid'],
    ]);
  });

  /*
   * Em aberto aqui e fora da lista: removida na Asaas (o aviso de remoção se
   * perdeu). Sem isto, ela travaria a empresa para sempre.
   */
  it('a fatura em aberto que a Asaas não tem mais fecha como cancelada', async () => {
    nossas = [
      { external_id: 'pay_9', status: 'overdue', valor_centavos: 4900, vencimento: '2026-08-13' },
    ];
    const { pedidos, buscador } = asaas([], { pay_9: null });

    const resultado = await conferirFaturas(banco(), ASSINATURA, buscador);

    expect(resultado).toMatchObject({ ok: true });
    expect(pedidos.some((url) => url.endsWith('/payments/pay_9'))).toBe(true);
    expect(gravacoes).toEqual([
      {
        p_provider: 'asaas',
        p_fatura: 'pay_9',
        p_assinatura: ASSINATURA,
        p_valor_centavos: 4900,
        p_status: 'canceled',
        p_vencimento: '2026-08-13',
      },
    ]);
  });

  it('a que está fora da lista e existe é gravada como a Asaas diz; a removida, cancelada', async () => {
    nossas = [
      { external_id: 'pay_7', status: 'pending', valor_centavos: 4900, vencimento: '2026-07-13' },
      { external_id: 'pay_8', status: 'overdue', valor_centavos: 4900, vencimento: '2026-06-13' },
    ];
    const { buscador } = asaas([], {
      pay_7: { ...PAGA, id: 'pay_7', value: 49, dueDate: '2026-07-13' },
      pay_8: { ...PAGA, id: 'pay_8', status: 'OVERDUE', dueDate: '2026-06-13', deleted: true },
    });

    const resultado = await conferirFaturas(banco(), ASSINATURA, buscador);

    expect(resultado).toMatchObject({ ok: true, pagasAgora: 1 });
    expect(gravacoes.map((g) => [g.p_fatura, g.p_status])).toEqual([
      ['pay_7', 'paid'],
      ['pay_8', 'canceled'],
    ]);
  });

  it('o banco que não grava conta, e a assinatura volta para o começo da fila', async () => {
    recusarGravacao = (args) => args.p_fatura === 'pay_1';
    const { buscador } = asaas([PAGA]);

    const resultado = await conferirFaturas(banco(), ASSINATURA, buscador);

    expect(resultado).toMatchObject({ ok: true, naoGravadas: 1 });
    expect(marcas).toEqual([]);
  });

  it('a Asaas fora do ar, ou o banco sem as faturas daqui: nada é gravado', async () => {
    const caiu = asaas([], {}, 503);
    expect((await conferirFaturas(banco(), ASSINATURA, caiu.buscador)).ok).toBe(false);

    erroDasNossas = { message: 'banco fora' };
    const { buscador } = asaas([PAGA]);
    expect((await conferirFaturas(banco(), ASSINATURA, buscador)).ok).toBe(false);
    expect(gravacoes).toEqual([]);
  });

  it('o link que não é endereço web não vai para a tela, e situação desconhecida fica de fora', async () => {
    const { buscador } = asaas([
      { ...PAGA, invoiceUrl: 'javascript:alert(1)' },
      { ...PAGA, id: 'pay_3', status: 'STATUS_NOVO' },
    ]);

    await conferirFaturas(banco(), ASSINATURA, buscador);

    expect(gravacoes).toHaveLength(1);
    expect(gravacoes[0]).not.toHaveProperty('p_link');
  });
});

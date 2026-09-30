/**
 * A conferência dos avisos da Shopify de uma loja: o que ela guarda em cada
 * caso. O que se pede à Shopify está provado em `shopify-servidor.test.ts`;
 * aqui, a LIGAÇÃO — e o que NÃO se guarda: a Shopify que não respondeu não
 * vira "faltam todos" na tela do lojista.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import type { ResultadoDosWebhooks } from '@/lib/shopify-servidor';
import type { TokenDaLoja } from '@/lib/shopify-conexao';
import type { TopicoDaLoja } from '@/lib/shopify';

const LOJA = 'loja-1';
const TODOS: TopicoDaLoja[] = [
  'app/uninstalled',
  'orders/create',
  'fulfillments/create',
  'products/update',
];

let token: TokenDaLoja = { ok: true, token: 'shpat_1', dominio: 'minha-loja.myshopify.com' };
let resultado: ResultadoDosWebhooks = {
  registrados: [],
  falharam: [],
  acessoRecusado: false,
  semResposta: false,
};
let pedidos: { dominio: string; url: string }[] = [];

vi.mock('@/lib/env', () => ({ urlDoSite: () => 'https://app.storefy.com.br' }));
vi.mock('@/lib/shopify-conexao', () => ({ tokenDaLoja: () => Promise.resolve(token) }));
vi.mock('@/lib/shopify-servidor', () => ({
  registrarWebhooks: (dominio: string, _token: string, url: string) => {
    pedidos.push({ dominio, url });
    return Promise.resolve(resultado);
  },
}));

const { conferirAvisosDaLoja } = await import('@/lib/avisos-da-shopify');

let gravado: Record<string, unknown>[] = [];

function banco(): SupabaseClient<Database> {
  return {
    from: () => ({
      update: (valores: Record<string, unknown>) => {
        gravado.push(valores);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  } as unknown as SupabaseClient<Database>;
}

let espioes: MockInstance[] = [];

beforeEach(() => {
  token = { ok: true, token: 'shpat_1', dominio: 'minha-loja.myshopify.com' };
  resultado = { registrados: [...TODOS], falharam: [], acessoRecusado: false, semResposta: false };
  pedidos = [];
  gravado = [];
  espioes = [
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  for (const espiao of espioes) espiao.mockRestore();
});

describe('conferirAvisosDaLoja', () => {
  it('tudo de pé: guarda que nada falta, e quando conferiu', async () => {
    expect(await conferirAvisosDaLoja(banco(), LOJA)).toEqual({
      ok: true,
      faltando: [],
      acessoRecusado: false,
    });
    expect(pedidos).toEqual([
      {
        dominio: 'minha-loja.myshopify.com',
        url: 'https://app.storefy.com.br/api/webhooks/shopify',
      },
    ]);
    expect(gravado).toEqual([
      {
        shopify_avisos_faltando: [],
        shopify_avisos_conferidos_em: expect.any(String) as unknown,
        shopify_acesso_recusado_em: null,
      },
    ]);
  });

  it('o aviso que a Shopify não aceitou fica guardado, para a C14 dizer qual', async () => {
    resultado = {
      registrados: ['app/uninstalled', 'orders/create', 'fulfillments/create'],
      falharam: ['products/update'],
      acessoRecusado: false,
      semResposta: false,
    };

    expect(await conferirAvisosDaLoja(banco(), LOJA)).toMatchObject({
      faltando: ['products/update'],
    });
    expect(gravado[0]).toMatchObject({ shopify_avisos_faltando: ['products/update'] });
  });

  it('o token recusado vira "acesso recusado", com a data', async () => {
    resultado = { registrados: [], falharam: [...TODOS], acessoRecusado: true, semResposta: false };

    expect(await conferirAvisosDaLoja(banco(), LOJA)).toMatchObject({ acessoRecusado: true });
    expect(typeof gravado[0]?.shopify_acesso_recusado_em).toBe('string');
  });

  /* O alarme falso que isto evita: "faltam todos" porque a Shopify piscou. */
  it('a Shopify que não respondeu não é guardada', async () => {
    resultado = { registrados: [], falharam: [...TODOS], acessoRecusado: false, semResposta: true };

    const conferencia = await conferirAvisosDaLoja(banco(), LOJA);

    expect(conferencia.ok).toBe(false);
    expect(gravado).toEqual([]);
  });

  it('a credencial que não serve mais conta como acesso recusado, sem chamar a Shopify', async () => {
    token = { ok: false, motivo: 'A conexão com a Shopify expirou.', reconectar: true };

    expect(await conferirAvisosDaLoja(banco(), LOJA)).toMatchObject({ acessoRecusado: true });
    expect(pedidos).toEqual([]);
    expect(gravado[0]).toMatchObject({ shopify_avisos_faltando: TODOS });
  });

  it('o banco ou a Shopify fora do ar na leitura do token não mudam nada', async () => {
    token = { ok: false, motivo: 'Tente de novo.', reconectar: false };

    expect(await conferirAvisosDaLoja(banco(), LOJA)).toEqual({
      ok: false,
      motivo: 'Tente de novo.',
    });
    expect(gravado).toEqual([]);
  });

  it('um domínio que não é de loja Shopify não vira chamada', async () => {
    token = { ok: true, token: 'shpat_1', dominio: 'evil.com' };

    expect((await conferirAvisosDaLoja(banco(), LOJA)).ok).toBe(false);
    expect(pedidos).toEqual([]);
  });
});

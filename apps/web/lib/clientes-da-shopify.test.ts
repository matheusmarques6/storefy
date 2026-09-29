/**
 * O cliente da loja pelo e-mail: a busca na Admin API e as três recusas que
 * pedem respostas diferentes a quem chamou o webhook.
 *
 * A conexão da loja é falsa (está provada em `shopify-conexao.test.ts`); a
 * chamada à Shopify passa pelo `consultarAdmin` de verdade, com um `fetch`
 * falso no lugar da rede.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import type { TokenDaLoja } from '@/lib/shopify-conexao';

let conexao: TokenDaLoja = { ok: true, token: 'shpat_teste', dominio: 'loja-teste.myshopify.com' };

vi.mock('@/lib/shopify-conexao', () => ({
  tokenDaLoja: () => Promise.resolve(conexao),
}));

const { clientesPeloEmail } = await import('@/lib/clientes-da-shopify');

const servico = {} as SupabaseClient<Database>;
const LOJA = '33333333-3333-4333-8333-333333333333';

let pedidos: { url: string; corpo: { query: string; variables: Record<string, unknown> } }[] = [];

function shopify(status: number, corpo: unknown): typeof fetch {
  return (entrada, init) => {
    pedidos.push({
      url: entrada instanceof Request ? entrada.url : String(entrada),
      corpo: JSON.parse(
        typeof init?.body === 'string' ? init.body : '{}',
      ) as (typeof pedidos)[number]['corpo'],
    });
    return Promise.resolve(new Response(JSON.stringify(corpo), { status }));
  };
}

beforeEach(() => {
  conexao = { ok: true, token: 'shpat_teste', dominio: 'loja-teste.myshopify.com' };
  pedidos = [];
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('clientesPeloEmail', () => {
  it('busca pelo e-mail na Admin API da loja e devolve os ids como o app grava', async () => {
    const buscador = shopify(200, {
      data: {
        customers: {
          nodes: [{ id: 'gid://shopify/Customer/7208822145' }, { id: 'gid://shopify/Customer/9' }],
        },
      },
    });

    const achados = await clientesPeloEmail(servico, LOJA, ' cliente@loja.com.br ', buscador);

    expect(achados).toEqual({ ok: true, ids: ['7208822145', '9'] });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toMatch(
      /^https:\/\/loja-teste\.myshopify\.com\/admin\/api\/.+\/graphql\.json$/,
    );
    expect(pedidos[0]?.corpo.variables).toEqual({ busca: 'email:"cliente@loja.com.br"' });
  });

  it('nenhum cliente com esse e-mail: lista vazia, e não erro', async () => {
    const achados = await clientesPeloEmail(
      servico,
      LOJA,
      'ninguem@loja.com.br',
      shopify(200, { data: { customers: { nodes: [] } } }),
    );
    expect(achados).toEqual({ ok: true, ids: [] });
  });

  it('o que não é id de cliente na resposta fica de fora', async () => {
    const achados = await clientesPeloEmail(
      servico,
      LOJA,
      'cliente@loja.com.br',
      shopify(200, {
        data: { customers: { nodes: [{ id: 'gid://shopify/Order/1' }, null, { outro: 1 }] } },
      }),
    );
    expect(achados).toEqual({ ok: true, ids: [] });
  });

  it('loja sem conexão: pede para reconectar, sem chamar a Shopify', async () => {
    conexao = { ok: false, motivo: 'Conecte a Shopify para usar este recurso.', reconectar: true };
    const achados = await clientesPeloEmail(servico, LOJA, 'cliente@loja.com.br', shopify(200, {}));
    expect(achados).toEqual({
      ok: false,
      motivo: 'Conecte a Shopify para usar este recurso.',
      causa: 'reconectar',
    });
    expect(pedidos).toEqual([]);
  });

  it('conexão ilegível agora (banco fora do ar): tentar de novo resolve', async () => {
    conexao = { ok: false, motivo: 'Não foi possível ler a conexão.', reconectar: false };
    const achados = await clientesPeloEmail(servico, LOJA, 'cliente@loja.com.br', shopify(200, {}));
    expect(!achados.ok && achados.causa).toBe('tente-de-novo');
  });

  it('sem a permissão de ler clientes: reconectar em Integrações', async () => {
    const achados = await clientesPeloEmail(
      servico,
      LOJA,
      'cliente@loja.com.br',
      shopify(200, {
        errors: [
          { message: 'Access denied for customers field.', extensions: { code: 'ACCESS_DENIED' } },
        ],
      }),
    );
    expect(achados).toEqual({
      ok: false,
      motivo:
        'A Shopify recusou a busca de clientes. Reconecte a loja em Integrações para dar a permissão de ler clientes.',
      causa: 'reconectar',
    });
  });

  it('a Shopify sem liberar dados de cliente para o app: pede o id no lugar do e-mail', async () => {
    const achados = await clientesPeloEmail(
      servico,
      LOJA,
      'cliente@loja.com.br',
      shopify(200, {
        errors: [
          {
            message:
              'This app is not approved to access the Customer object. See https://shopify.dev/docs/apps/launch/protected-customer-data for more details.',
            extensions: { code: 'ACCESS_DENIED' },
          },
        ],
      }),
    );
    expect(!achados.ok && achados.causa).toBe('use-o-id');
    expect(!achados.ok && achados.motivo).toContain('customerId');
  });

  it('a Shopify fora do ar: tentar de novo', async () => {
    const achados = await clientesPeloEmail(
      servico,
      LOJA,
      'cliente@loja.com.br',
      shopify(502, { erro: 'bad gateway' }),
    );
    expect(achados).toEqual({
      ok: false,
      motivo: 'A Shopify não respondeu a busca do cliente. Tente de novo em instantes.',
      causa: 'tente-de-novo',
    });
  });

  it('token recusado (401): reconectar', async () => {
    const achados = await clientesPeloEmail(
      servico,
      LOJA,
      'cliente@loja.com.br',
      shopify(401, { errors: 'Invalid API key or access token' }),
    );
    expect(!achados.ok && achados.causa).toBe('reconectar');
  });
});

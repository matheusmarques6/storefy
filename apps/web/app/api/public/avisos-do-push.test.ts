/**
 * `POST /api/public/push-avisos` de ponta a ponta: a assinatura, as duas
 * leituras e a resposta que o pedido de permissão do app (M03) usa.
 *
 * A decisão está provada em `lib/endpoint-do-app.test.ts`; aqui se prova a
 * ligação — as leituras certas, nas tabelas certas, e nenhuma falha do banco
 * saindo como a página de erro do Next.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import { assinar } from '@/lib/assinatura';
import { criptografar } from '@/lib/cripto';

const CHAVE = Buffer.alloc(32, 9).toString('base64');
const SEGREDO = 'segredo-do-app-dos-avisos';
const APP = '77777777-7777-4777-8777-777777777777';

interface Leitura {
  data: unknown;
  error: { message: string } | null;
}

let segredoNoBanco: string | null = null;
let automacoes: Leitura = { data: [], error: null };
let loja: Leitura = { data: null, error: null };
let explodir = false;
/** Os filtros de cada leitura, para conferir que só o ligado deste app é lido. */
let filtros: Record<string, [string, unknown][]> = {};

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave-de-teste',
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => ({
    from: (tabela: string) => {
      if (explodir) throw new Error('conexão recusada');
      const usados: [string, unknown][] = [];
      filtros[tabela] = usados;
      const consulta = {
        select: () => consulta,
        eq: (coluna: string, valor: unknown) => {
          usados.push([coluna, valor]);
          return consulta;
        },
        maybeSingle: () => Promise.resolve(tabela === 'apps' ? loja : { data: null, error: null }),
        then: (resolver: (valor: Leitura) => unknown) => Promise.resolve(automacoes).then(resolver),
      };
      return consulta;
    },
  }),
}));

// O segredo é lido pelo próprio módulo; aqui ele vem direto.
vi.mock('@/lib/segredo-do-app', () => ({
  buscarSegredoCifrado: () => Promise.resolve(segredoNoBanco),
}));

const { POST } = await import('@/app/api/public/push-avisos/route');

let chaveOriginal: string | undefined;
let avisosDoLog: MockInstance<typeof console.warn>;

beforeEach(() => {
  chaveOriginal = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = CHAVE;
  segredoNoBanco = criptografar(SEGREDO);
  automacoes = { data: [], error: null };
  loja = {
    data: { stores: { platform: 'shopify', shopify_scopes: ['read_orders'] } },
    error: null,
  };
  explodir = false;
  filtros = {};
  avisosDoLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  if (chaveOriginal === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = chaveOriginal;
  avisosDoLog.mockRestore();
});

function requisicao(assinatura: string | null, corpo = JSON.stringify({ appId: APP })) {
  const cabecalhos = new Headers({ 'Content-Type': 'application/json' });
  if (assinatura !== null) cabecalhos.set('x-storefy-signature', assinatura);
  return new NextRequest('https://app.storefy.com.br/api/public/push-avisos', {
    method: 'POST',
    headers: cabecalhos,
    body: corpo,
  });
}

const corpo = JSON.stringify({ appId: APP });

describe('POST /api/public/push-avisos', () => {
  it('lista os avisos das automações ligadas deste app', async () => {
    automacoes = { data: [{ type: 'order_shipped' }, { type: 'abandoned_cart' }], error: null };

    const resposta = await POST(requisicao(assinar(SEGREDO, Date.now(), corpo)));

    expect(resposta.status).toBe(200);
    await expect(resposta.json()).resolves.toEqual({ avisos: ['carrinho', 'pedido'] });
    expect(resposta.headers.get('Cache-Control')).toBe('no-store');
    expect(filtros.push_automations).toEqual([
      ['app_id', APP],
      ['enabled', true],
    ]);
    expect(filtros.apps).toEqual([['id', APP]]);
  });

  it('sem a Shopify conectada, promete só o carrinho', async () => {
    automacoes = {
      data: [{ type: 'order_shipped' }, { type: 'back_in_stock' }, { type: 'abandoned_cart' }],
      error: null,
    };
    loja = { data: { stores: { platform: 'shopify', shopify_scopes: null } }, error: null };

    const resposta = await POST(requisicao(assinar(SEGREDO, Date.now(), corpo)));
    await expect(resposta.json()).resolves.toEqual({ avisos: ['carrinho'] });
  });

  it('sem assinatura, ou com a de outro app, não lê nada', async () => {
    for (const assinatura of [null, assinar('outro-segredo', Date.now(), corpo)]) {
      filtros = {};
      const resposta = await POST(requisicao(assinatura));
      expect(resposta.status, String(assinatura)).toBe(401);
      await expect(resposta.json()).resolves.toEqual({ erro: 'nao_autorizado' });
      expect(filtros).toEqual({});
    }
  });

  it('o banco com erro, ou fora do ar, responde 503 em JSON', async () => {
    automacoes = { data: null, error: { message: 'tempo esgotado' } };
    const comErro = await POST(requisicao(assinar(SEGREDO, Date.now(), corpo)));
    expect(comErro.status).toBe(503);
    await expect(comErro.json()).resolves.toEqual({ erro: 'indisponivel' });

    automacoes = { data: [], error: null };
    loja = { data: null, error: { message: 'tempo esgotado' } };
    expect((await POST(requisicao(assinar(SEGREDO, Date.now(), corpo)))).status).toBe(503);

    loja = { data: { stores: { platform: 'shopify', shopify_scopes: null } }, error: null };
    explodir = true;
    const foraDoAr = await POST(requisicao(assinar(SEGREDO, Date.now(), corpo)));
    expect(foraDoAr.status).toBe(503);
    expect(foraDoAr.headers.get('Content-Type')).toContain('application/json');
  });
});

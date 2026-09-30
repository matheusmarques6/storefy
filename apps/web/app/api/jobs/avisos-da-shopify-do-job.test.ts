/**
 * O cron dos avisos da Shopify, de ponta a ponta: a LIGAÇÃO entre o Vercel
 * Cron, a fila de lojas conectadas e `conferirAvisosDaLoja`. O que a
 * conferência guarda está provado em `lib/avisos-da-shopify.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';

const SEGREDO_DO_CRON = 'segredo-do-cron-dos-avisos';

let lojas: { id: string }[] = [];
let erroDaFila: { message: string } | null = null;
let filtros: { metodo: string; args: unknown[] }[] = [];
let batimentos: Record<string, unknown>[] = [];
let conferidas: string[] = [];
let resultadoPor: (loja: string) => unknown = () => ({
  ok: true,
  faltando: [],
  acessoRecusado: false,
});

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave',
  urlDoSite: () => 'https://app.storefy.com.br',
}));

vi.mock('@/lib/cripto', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  criptografiaConfigurada: () => true,
}));

vi.mock('@/lib/avisos-da-shopify', () => ({
  conferirAvisosDaLoja: (_servico: unknown, loja: string) => {
    conferidas.push(loja);
    return Promise.resolve(resultadoPor(loja));
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => ({
    from: () => {
      const cadeia: Record<string, unknown> = {};
      for (const metodo of ['select', 'not', 'or', 'order', 'limit']) {
        cadeia[metodo] = (...args: unknown[]) => {
          filtros.push({ metodo, args });
          return cadeia;
        };
      }
      cadeia.then = (aceitar: (v: unknown) => unknown) =>
        aceitar({ data: erroDaFila === null ? lojas : null, error: erroDaFila });
      return cadeia;
    },
    rpc: (nome: string, args: Record<string, unknown>) => {
      if (nome === 'registrar_batimento') batimentos.push(args);
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const { GET } = await import('@/app/api/jobs/shopify-webhooks/route');

let segredoOriginal: string | undefined;
let espioes: MockInstance[] = [];

beforeEach(() => {
  segredoOriginal = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SEGREDO_DO_CRON;
  lojas = [{ id: 'loja-1' }, { id: 'loja-2' }, { id: 'loja-3' }];
  erroDaFila = null;
  filtros = [];
  batimentos = [];
  conferidas = [];
  resultadoPor = () => ({ ok: true, faltando: [], acessoRecusado: false });
  espioes = [
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  if (segredoOriginal === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = segredoOriginal;
  for (const espiao of espioes) espiao.mockRestore();
});

function chamar(autorizacao: string | null = `Bearer ${SEGREDO_DO_CRON}`): NextRequest {
  const cabecalhos = new Headers();
  if (autorizacao !== null) cabecalhos.set('authorization', autorizacao);
  return new NextRequest('https://app.storefy.com.br/api/jobs/shopify-webhooks', {
    headers: cabecalhos,
  });
}

describe('GET /api/jobs/shopify-webhooks', () => {
  it('sem o segredo do cron, não confere nada', async () => {
    const res = await GET(chamar(null));
    expect(res.status).toBe(401);
    expect(conferidas).toEqual([]);
  });

  it('confere as lojas conectadas, a menos conferida primeiro, e diz o que achou', async () => {
    resultadoPor = (loja) =>
      loja === 'loja-2'
        ? { ok: true, faltando: ['products/update'], acessoRecusado: false }
        : loja === 'loja-3'
          ? { ok: true, faltando: [], acessoRecusado: true }
          : { ok: true, faltando: [], acessoRecusado: false };

    const res = await GET(chamar());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      conferidas: 3,
      comFalta: 1,
      recusadas: 1,
      semResposta: 0,
    });
    expect(conferidas).toEqual(['loja-1', 'loja-2', 'loja-3']);
    // Só a loja conectada, e só a que não foi conferida nas últimas horas.
    expect(filtros).toContainEqual({ metodo: 'not', args: ['shopify_scopes', 'is', null] });
    const fila = filtros.find((filtro) => filtro.metodo === 'or');
    expect(String(fila?.args[0])).toMatch(
      /^shopify_avisos_conferidos_em\.is\.null,shopify_avisos_conferidos_em\.lt\./,
    );
    expect(batimentos).toEqual([
      expect.objectContaining({ p_job: 'shopify-webhooks', p_ok: true }),
    ]);
  });

  it('uma loja sem resposta não para as outras', async () => {
    resultadoPor = (loja) =>
      loja === 'loja-1'
        ? { ok: false, motivo: 'A Shopify não respondeu agora.' }
        : { ok: true, faltando: [], acessoRecusado: false };

    const res = await GET(chamar());

    expect(await res.json()).toMatchObject({ ok: true, conferidas: 2, semResposta: 1 });
    expect(batimentos).toEqual([expect.objectContaining({ p_ok: true })]);
  });

  /* Nenhuma respondeu: é a Shopify (ou a nossa rede), e a página de status diz. */
  it('nenhuma respondendo, o job acusa a falha no batimento', async () => {
    resultadoPor = () => ({ ok: false, motivo: 'A Shopify não respondeu agora.' });

    const res = await GET(chamar());

    expect(res.status).toBe(500);
    expect(batimentos).toEqual([
      expect.objectContaining({ p_job: 'shopify-webhooks', p_ok: false }),
    ]);
  });

  it('sem a fila do banco, falha e anota', async () => {
    erroDaFila = { message: 'banco fora' };

    const res = await GET(chamar());

    expect(res.status).toBe(500);
    expect(conferidas).toEqual([]);
    expect(batimentos).toEqual([expect.objectContaining({ p_ok: false })]);
  });

  it('sem loja conectada, roda e anota que rodou', async () => {
    lojas = [];

    const res = await GET(chamar());

    expect(await res.json()).toMatchObject({ ok: true, conferidas: 0 });
    expect(batimentos).toEqual([expect.objectContaining({ p_ok: true })]);
  });
});

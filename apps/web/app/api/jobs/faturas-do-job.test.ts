/**
 * O cron da conferência das faturas, de ponta a ponta: a LIGAÇÃO entre o
 * Vercel Cron, a fila de assinaturas e `conferirFaturas`. O que a conferência
 * grava está provado em `lib/conferencia-das-faturas.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';

const SEGREDO_DO_CRON = 'segredo-do-cron-das-faturas';

let configurada = true;
let assinaturas: { external_id: string }[] = [];
let erroDaFila: { message: string } | null = null;
let filtros: { metodo: string; args: unknown[] }[] = [];
let batimentos: Record<string, unknown>[] = [];
let conferidas: string[] = [];
let resultadoPor: (assinatura: string) => unknown = () => ({
  ok: true,
  faturas: [],
  pagasAgora: 0,
  naoGravadas: 0,
});

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave',
  urlDoSite: () => 'https://app.storefy.com.br',
}));

vi.mock('@/lib/asaas', () => ({ cobrancaConfigurada: () => configurada }));

vi.mock('@/lib/conferencia-das-faturas', () => ({
  conferirFaturas: (_servico: unknown, assinatura: string) => {
    conferidas.push(assinatura);
    return Promise.resolve(resultadoPor(assinatura));
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => ({
    from: () => {
      const cadeia: Record<string, unknown> = {};
      for (const metodo of ['select', 'eq', 'is', 'or', 'order', 'limit']) {
        cadeia[metodo] = (...args: unknown[]) => {
          filtros.push({ metodo, args });
          return cadeia;
        };
      }
      cadeia.then = (aceitar: (v: unknown) => unknown) =>
        aceitar({ data: erroDaFila === null ? assinaturas : null, error: erroDaFila });
      return cadeia;
    },
    rpc: (nome: string, args: Record<string, unknown>) => {
      if (nome === 'registrar_batimento') batimentos.push(args);
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const { GET } = await import('@/app/api/jobs/invoice-sync/route');

let segredoOriginal: string | undefined;
let espioes: MockInstance[] = [];

beforeEach(() => {
  segredoOriginal = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SEGREDO_DO_CRON;
  configurada = true;
  assinaturas = [{ external_id: 'sub_1' }, { external_id: 'sub_2' }];
  erroDaFila = null;
  filtros = [];
  batimentos = [];
  conferidas = [];
  resultadoPor = () => ({ ok: true, faturas: [], pagasAgora: 0, naoGravadas: 0 });
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
  return new NextRequest('https://app.storefy.com.br/api/jobs/invoice-sync', {
    headers: cabecalhos,
  });
}

describe('GET /api/jobs/invoice-sync', () => {
  it('sem o segredo do cron, não confere nada', async () => {
    const res = await GET(chamar('Bearer outro'));
    expect(res.status).toBe(401);
    expect(conferidas).toEqual([]);
    expect(batimentos).toEqual([]);
  });

  it('confere as assinaturas vivas, a menos conferida primeiro, e diz o que achou', async () => {
    resultadoPor = (assinatura) => ({
      ok: true,
      faturas: [],
      pagasAgora: assinatura === 'sub_2' ? 1 : 0,
      naoGravadas: 0,
    });

    const res = await GET(chamar());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, conferidas: 2, pagasAgora: 1, falhas: 0 });
    expect(conferidas).toEqual(['sub_1', 'sub_2']);
    // Só a assinatura viva, e só a que não foi conferida nas últimas horas.
    expect(filtros).toContainEqual({ metodo: 'is', args: ['cancelada_em', null] });
    const fila = filtros.find((filtro) => filtro.metodo === 'or');
    expect(String(fila?.args[0])).toMatch(/^conferida_em\.is\.null,conferida_em\.lt\./);
    expect(filtros).toContainEqual({
      metodo: 'order',
      args: ['conferida_em', { ascending: true, nullsFirst: true }],
    });
    expect(batimentos).toEqual([expect.objectContaining({ p_job: 'invoice-sync', p_ok: true })]);
  });

  it('uma que falha não para as outras', async () => {
    resultadoPor = (assinatura) =>
      assinatura === 'sub_1'
        ? { ok: false, motivo: 'Asaas fora' }
        : { ok: true, faturas: [], pagasAgora: 0, naoGravadas: 0 };

    const res = await GET(chamar());

    expect(await res.json()).toMatchObject({ ok: true, conferidas: 1, falhas: 1 });
    expect(batimentos).toEqual([expect.objectContaining({ p_ok: true })]);
  });

  /* Nenhuma conferida: é a Asaas (ou a chave), e a página de status precisa dizer. */
  it('todas falhando, o job acusa a falha no batimento', async () => {
    resultadoPor = () => ({ ok: true, faturas: [], pagasAgora: 0, naoGravadas: 2 });

    const res = await GET(chamar());

    expect(res.status).toBe(500);
    expect(batimentos).toEqual([expect.objectContaining({ p_job: 'invoice-sync', p_ok: false })]);
  });

  it('sem a fila do banco, falha e anota', async () => {
    erroDaFila = { message: 'banco fora' };

    const res = await GET(chamar());

    expect(res.status).toBe(500);
    expect(conferidas).toEqual([]);
    expect(batimentos).toEqual([expect.objectContaining({ p_ok: false })]);
  });

  it('sem a Asaas configurada não há o que conferir, e o job diz isso', async () => {
    configurada = false;

    const res = await GET(chamar());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignorado: 'cobranca_nao_configurada' });
    expect(conferidas).toEqual([]);
    expect(batimentos).toEqual([expect.objectContaining({ p_ok: true })]);
  });
});

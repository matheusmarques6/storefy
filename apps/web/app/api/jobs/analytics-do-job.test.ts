/**
 * O cron que recalcula os números do dia, de ponta a ponta.
 *
 * `lib/analytics.test.ts` prova a leitura da janela; aqui se prova a LIGAÇÃO,
 * que é onde mora o risco: que ninguém sem o segredo faça a Storefy varrer os
 * pedidos de todos os clientes, e que uma falha do banco vire 500 — um 200
 * mentiroso faria o cron seguir em frente achando que consolidou.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';

const SEGREDO_DO_CRON = 'segredo-do-cron-dos-numeros';

/** O que foi chamado no banco. */
let chamadas: { nome: string; args: Record<string, unknown> }[] = [];
/** O que `consolidar_analytics` responde. */
let resposta: { data: unknown; error: { message: string } | null } = { data: 7, error: null };
let explodir = false;

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave',
  urlDoSite: () => 'https://app.storefy.com.br',
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => {
    if (explodir) throw new Error('banco fora do ar');
    return {
      rpc: (nome: string, args: Record<string, unknown>) => {
        chamadas.push({ nome, args });
        return Promise.resolve(resposta);
      },
    };
  },
}));

const { GET } = await import('@/app/api/jobs/analytics/route');

let segredoOriginal: string | undefined;
let avisos: MockInstance<typeof console.warn>;
let erros: MockInstance<typeof console.error>;

beforeEach(() => {
  segredoOriginal = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SEGREDO_DO_CRON;
  chamadas = [];
  resposta = { data: 7, error: null };
  explodir = false;
  avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  erros = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  if (segredoOriginal === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = segredoOriginal;
  avisos.mockRestore();
  erros.mockRestore();
});

function chamar(busca = '', autorizacao: string | null = `Bearer ${SEGREDO_DO_CRON}`): NextRequest {
  const cabecalhos = new Headers();
  if (autorizacao !== null) cabecalhos.set('authorization', autorizacao);
  return new NextRequest(`https://app.storefy.com.br/api/jobs/analytics${busca}`, {
    headers: cabecalhos,
  });
}

describe('GET /api/jobs/analytics', () => {
  it('consolida a janela padrão e diz quantos dias escreveu', async () => {
    const res = await GET(chamar());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, dias: 3, escritas: 7 });
    expect(chamadas).toEqual([{ nome: 'consolidar_analytics', args: { p_dias: 3 } }]);
  });

  it('respeita a janela pedida na chamada', async () => {
    await GET(chamar('?dias=30'));

    expect(chamadas[0]?.args).toEqual({ p_dias: 30 });
  });

  it('e não deixa pedir uma janela absurda', async () => {
    await GET(chamar('?dias=100000'));

    expect(chamadas[0]?.args).toEqual({ p_dias: 90 });
  });

  /*
   * Sem esta guarda, qualquer um faria a Storefy varrer os pedidos de todos os
   * clientes quantas vezes quisesse.
   */
  it('sem o segredo do cron, ninguém consolida nada', async () => {
    for (const autorizacao of [null, 'Bearer errado', '', 'Basic algo']) {
      const res = await GET(chamar('', autorizacao));
      expect(res.status, String(autorizacao)).toBe(401);
    }
    expect(chamadas).toEqual([]);
  });

  /* Sem `CRON_SECRET` a resposta é 503, e não "deixa passar". */
  it('sem CRON_SECRET configurado a rota fecha', async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(chamar('', null));
    expect(res.status).toBe(503);
    expect(chamadas).toEqual([]);
  });

  /*
   * Falha vira 500. Um 200 aqui faria o cron seguir em frente achando que
   * consolidou, e o painel mostraria o número de antes como se fosse de agora.
   */
  it('erro do banco vira 500', async () => {
    resposta = { data: null, error: { message: 'deadlock detected' } };

    expect((await GET(chamar())).status).toBe(500);
  });

  it('e uma exceção também', async () => {
    explodir = true;

    expect((await GET(chamar())).status).toBe(500);
  });

  it('a resposta nunca fica em cache', async () => {
    const res = await GET(chamar());

    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

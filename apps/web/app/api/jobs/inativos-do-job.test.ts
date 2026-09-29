/**
 * O cron do "sentimos sua falta", de ponta a ponta: a LIGAÇÃO entre o Vercel
 * Cron e `agendar_inativos`. O que a função agenda (a janela de 7 a 9 dias,
 * um aviso por sumiço, o cancelamento de quem voltou) está provado no
 * `rls.test.sql`, contra o Postgres de verdade.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';

const SEGREDO_DO_CRON = 'segredo-do-cron-dos-inativos';

let chamadas: { nome: string; args: Record<string, unknown> | undefined }[] = [];
let resposta: { data: unknown; error: { message: string } | null } = { data: 3, error: null };
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
      rpc: (nome: string, args?: Record<string, unknown>) => {
        chamadas.push({ nome, args });
        return Promise.resolve(
          nome === 'registrar_batimento' ? { data: null, error: null } : resposta,
        );
      },
    };
  },
}));

const { GET } = await import('@/app/api/jobs/inactive-devices/route');

let segredoOriginal: string | undefined;
let espioes: MockInstance[] = [];

beforeEach(() => {
  segredoOriginal = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SEGREDO_DO_CRON;
  chamadas = [];
  resposta = { data: 3, error: null };
  explodir = false;
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
  return new NextRequest('https://app.storefy.com.br/api/jobs/inactive-devices', {
    headers: cabecalhos,
  });
}

describe('GET /api/jobs/inactive-devices', () => {
  it('agenda os avisos, diz quantos e anota o batimento', async () => {
    const res = await GET(chamar());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, agendados: 3 });
    expect(chamadas).toEqual([
      { nome: 'agendar_inativos', args: undefined },
      {
        nome: 'registrar_batimento',
        args: {
          p_job: 'inactive-devices',
          p_ok: true,
          p_duracao_ms: expect.any(Number) as number,
        },
      },
    ]);
  });

  it('sem o segredo do cron, ninguém agenda nada', async () => {
    for (const autorizacao of [null, 'Bearer errado', '', 'Basic algo']) {
      expect((await GET(chamar(autorizacao))).status, String(autorizacao)).toBe(401);
    }
    expect(chamadas).toEqual([]);
  });

  it('sem CRON_SECRET configurado a rota fecha', async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(chamar(null))).status).toBe(503);
    expect(chamadas).toEqual([]);
  });

  it('erro do banco vira 500, e a falha fica no batimento', async () => {
    resposta = { data: null, error: { message: 'statement timeout' } };

    expect((await GET(chamar())).status).toBe(500);
    expect(chamadas.at(-1)).toEqual({
      nome: 'registrar_batimento',
      args: {
        p_job: 'inactive-devices',
        p_ok: false,
        p_duracao_ms: expect.any(Number) as number,
        p_erro: 'statement timeout',
      },
    });
  });

  it('e uma exceção também vira 500, sem HTML', async () => {
    explodir = true;
    const res = await GET(chamar());
    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });
});

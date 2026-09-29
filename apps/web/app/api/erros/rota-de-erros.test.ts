/**
 * `POST /api/erros`, de ponta a ponta: o que chega, o que é recusado calado e
 * o que segue para o Sentry. O Sentry e o banco são falsos; a rota, não.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/** O que `consumir_limite` responde, por chave. */
let limites: Record<string, boolean> = {};
let chavesPedidas: string[] = [];
/** Quando preenchido, `consumir_limite` falha como falharia com o banco fora. */
let falhaDoTeto: { message: string } | null = null;

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave-de-teste',
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => ({
    rpc: (_nome: string, args: { p_chave: string }) => {
      chavesPedidas.push(args.p_chave);
      const prefixo = args.p_chave === 'erros:todos' ? 'todos' : 'pessoa';
      if (falhaDoTeto !== null) return Promise.resolve({ data: null, error: falhaDoTeto });
      return Promise.resolve({ data: limites[prefixo] ?? true, error: null });
    },
  }),
}));

const { POST } = await import('@/app/api/erros/route');

const DSN = 'https://abc@o1.ingest.sentry.io/99';
const ORIGINAL = process.env.SENTRY_DSN;
let enviados: string[] = [];

beforeEach(() => {
  process.env.SENTRY_DSN = DSN;
  limites = {};
  chavesPedidas = [];
  falhaDoTeto = null;
  enviados = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      enviados.push(typeof init?.body === 'string' ? init.body : '');
      return await Promise.resolve(new Response('{}', { status: 200 }));
    }),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (ORIGINAL === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = ORIGINAL;
});

function pedido(corpo: unknown, ip = '203.0.113.7'): NextRequest {
  return new NextRequest('http://app.localhost/api/erros', {
    method: 'POST',
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 10.0.0.1` },
  });
}

const BOM = {
  tipo: 'TypeError',
  mensagem: 'x is undefined',
  pilha: 'TypeError: x is undefined\n    at salvar (https://app/_next/a.js:1:2)',
  pagina: '/publicacao',
  onde: 'tela',
};

describe('POST /api/erros', () => {
  it('segue para o Sentry, com a pilha do navegador e a página', async () => {
    const resposta = await POST(pedido(BOM));

    expect(resposta.status).toBe(204);
    expect(enviados).toHaveLength(1);
    const evento = JSON.parse(enviados[0]?.split('\n')[2] ?? '{}') as {
      tags: Record<string, string>;
      exception: { values: { type: string; value: string; stacktrace: { frames: unknown[] } }[] };
    };
    expect(evento.tags).toMatchObject({ origem: 'navegador', pagina: '/publicacao', onde: 'tela' });
    expect(evento.exception.values[0]).toMatchObject({
      type: 'TypeError',
      value: 'x is undefined',
    });
    expect(evento.exception.values[0]?.stacktrace.frames).toHaveLength(1);
  });

  it('o IP não é guardado: o teto usa um resumo dele', async () => {
    await POST(pedido(BOM));
    expect(chavesPedidas).toContain('erros:todos');
    expect(chavesPedidas.join(' ')).not.toContain('203.0.113.7');
  });

  it('sem Sentry configurado, nada acontece — nem no banco', async () => {
    delete process.env.SENTRY_DSN;
    expect((await POST(pedido(BOM))).status).toBe(204);
    expect(enviados).toEqual([]);
    expect(chavesPedidas).toEqual([]);
  });

  it('corpo fora do formato é descartado calado', async () => {
    for (const ruim of [
      'não é json',
      '',
      { ...BOM, pagina: 'https://outro.site' },
      { ...BOM, onde: 'qualquer' },
      { ...BOM, mensagem: '' },
      'x'.repeat(10_000),
    ]) {
      expect((await POST(pedido(ruim))).status).toBe(204);
    }
    expect(enviados).toEqual([]);
  });

  it('acima do teto, por pessoa ou no total, não chega ao Sentry', async () => {
    limites = { pessoa: false };
    await POST(pedido(BOM));
    limites = { todos: false };
    await POST(pedido(BOM));
    expect(enviados).toEqual([]);
  });

  it('sem o teto (banco fora), não manda, e diz no log por quê', async () => {
    const erros = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    falhaDoTeto = { message: 'conexão caiu' };
    expect((await POST(pedido(BOM))).status).toBe(204);
    expect(enviados).toEqual([]);
    const linha = JSON.parse(String(erros.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(linha).toMatchObject({ evento: 'erros-do-navegador.teto-indisponivel' });
  });
});

/**
 * A rota da prévia antes de ir à loja: sessão e o id da loja. O que ela faz
 * com a página da loja está em `lib/preview-proxy.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const LOJA = '77777777-7777-4777-8777-777777777777';

let usuario: { id: string } | null = { id: 'pessoa' };
const consultas: string[] = [];

vi.mock('@/lib/supabase/server', () => ({
  criarClientServidor: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: usuario } }) },
      from: (tabela: string) => {
        consultas.push(tabela);
        const cadeia = {
          select: () => cadeia,
          eq: () => cadeia,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
        return cadeia;
      },
    }),
}));

const { GET } = await import('./route');

function pedir(consulta: string): Promise<Response> {
  return GET(new NextRequest(`http://app.localhost:3000/api/preview-proxy${consulta}`));
}

beforeEach(() => {
  usuario = { id: 'pessoa' };
  consultas.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('GET /api/preview-proxy', () => {
  it('sem sessão, pede o login', async () => {
    usuario = null;
    expect((await pedir(`?loja=${LOJA}`)).status).toBe(401);
  });

  it('sem loja, ou com um id que não é id, é "loja não encontrada" — sem ir ao banco', async () => {
    for (const consulta of ['', '?loja=', '?loja=nao-e-um-id', `?loja=${LOJA}x`]) {
      const resposta = await pedir(consulta);
      expect(resposta.status, consulta).toBe(404);
      expect(await resposta.text()).toContain('Loja não encontrada.');
    }
    expect(consultas).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('a loja que a RLS não mostra também é "não encontrada"', async () => {
    const resposta = await pedir(`?loja=${LOJA}`);
    expect(resposta.status).toBe(404);
    expect(consultas).toEqual(['stores']);
  });
});

/**
 * `/privacy/app/<appId>`: o app acha a política da loja dele sem saber o id
 * da loja. O que importa provar é para ONDE vai — a loja dona do app, e mais
 * nenhuma — e que um id qualquer não vira consulta.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const APP = '22222222-2222-4222-8222-222222222222';
const LOJA = '11111111-1111-4111-8111-111111111111';

let linhaDoApp: { store_id: string } | null = null;
let consultas: { tabela: string; colunas: string; valor: unknown }[] = [];

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave',
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => ({
    from: (tabela: string) => ({
      select: (colunas: string) => ({
        eq: (_coluna: string, valor: unknown) => {
          consultas.push({ tabela, colunas, valor });
          return { maybeSingle: () => Promise.resolve({ data: linhaDoApp, error: null }) };
        },
      }),
    }),
  }),
}));

const { default: PoliticaDoApp } = await import('@/app/privacy/app/[appId]/page');

/** O que o `redirect`/`notFound` do Next lança, lido pelo `digest`. */
async function destino(appId: string): Promise<string> {
  try {
    await PoliticaDoApp({ params: Promise.resolve({ appId }) });
  } catch (erro) {
    return String((erro as { digest?: unknown }).digest);
  }
  throw new Error('A página deveria ter redirecionado ou dado 404.');
}

beforeEach(() => {
  linhaDoApp = { store_id: LOJA };
  consultas = [];
});

describe('/privacy/app/[appId]', () => {
  it('leva à política da loja dona do app', async () => {
    expect(await destino(APP)).toContain(`;/privacy/${LOJA};`);
    expect(consultas).toEqual([{ tabela: 'apps', colunas: 'store_id', valor: APP }]);
  });

  it('app que não existe é 404, e não uma política vazia', async () => {
    linhaDoApp = null;
    expect(await destino(APP)).toContain('404');
  });

  it('id que não é uuid é 404 sem ir ao banco', async () => {
    expect(await destino("x' or 1=1")).toContain('404');
    expect(consultas).toEqual([]);
  });
});

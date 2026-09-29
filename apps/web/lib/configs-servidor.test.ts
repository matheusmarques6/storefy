/**
 * `garantirRascunho` com o banco falhando no meio.
 *
 * O defeito: as duas leituras de `app_configs` corriam num `Promise.all` que
 * jogava o erro fora. Com a leitura do rascunho falhando e a da maior versão
 * funcionando, "não li" virava "não existe" — e a função criava um rascunho
 * NOVO, com a config padrão, por cima do que o lojista vinha editando. O
 * editor passava a abrir esse, e as edições salvas sumiam da tela.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { configInicial } from '@storefy/config-schema';
import type { Database } from '@storefy/db';
import { garantirRascunho } from '@/lib/configs-servidor';

const LOJA = '33333333-3333-4333-8333-333333333333';
const APP = '22222222-2222-4222-8222-222222222222';

interface Resposta {
  data: unknown;
  error: { message: string } | null;
}

interface Banco {
  maior: Resposta;
  rascunho: Resposta;
}

function falso(banco: Banco) {
  const inseridos: Record<string, unknown>[] = [];
  const loja = {
    name: 'Oak Vintage',
    primary_url: 'https://oakvintage.com.br',
    shop_domain: 'oak-vintage.myshopify.com',
    platform: 'shopify',
  };

  const cliente = {
    from: (tabela: string) => ({
      select: (colunas: string) => {
        const cadeia = {
          eq: () => cadeia,
          order: () => cadeia,
          limit: () => cadeia,
          maybeSingle: () =>
            Promise.resolve(
              tabela === 'stores'
                ? { data: loja, error: null }
                : tabela === 'apps'
                  ? { data: { id: APP }, error: null }
                  : colunas === 'version'
                    ? banco.maior
                    : banco.rascunho,
            ),
        };
        return cadeia;
      },
      insert: (linha: Record<string, unknown>) => {
        inseridos.push(linha);
        return Promise.resolve({ error: null });
      },
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    }),
  };

  return { cliente: cliente as unknown as SupabaseClient<Database>, inseridos };
}

const FORA_DO_AR = { data: null, error: { message: 'conexão perdida' } };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('garantirRascunho', () => {
  it('leitura do rascunho que falha NÃO cria outro por cima', async () => {
    const { cliente, inseridos } = falso({
      maior: { data: { version: 4 }, error: null },
      rascunho: FORA_DO_AR,
    });

    const resultado = await garantirRascunho(cliente, LOJA);

    expect(resultado.ok).toBe(false);
    expect(inseridos).toEqual([]);
  });

  it('leitura da maior versão que falha também para tudo', async () => {
    const { cliente, inseridos } = falso({
      maior: FORA_DO_AR,
      rascunho: { data: null, error: null },
    });

    expect((await garantirRascunho(cliente, LOJA)).ok).toBe(false);
    expect(inseridos).toEqual([]);
  });

  it('com as leituras em dia, o rascunho que existe é o que abre', async () => {
    const config = configInicial(
      {
        name: 'Oak Vintage',
        url: 'https://oakvintage.com.br',
        shopDomain: 'oak-vintage.myshopify.com',
        platform: 'shopify',
      },
      4,
    );
    const { cliente, inseridos } = falso({
      maior: { data: { version: 4 }, error: null },
      rascunho: { data: { version: 4, config }, error: null },
    });

    const resultado = await garantirRascunho(cliente, LOJA);

    expect(resultado.ok && resultado.rascunho.version).toBe(4);
    expect(inseridos).toEqual([]);
  });

  it('sem rascunho de verdade, cria o próximo número', async () => {
    const { cliente, inseridos } = falso({
      maior: { data: { version: 4 }, error: null },
      rascunho: { data: null, error: null },
    });

    const resultado = await garantirRascunho(cliente, LOJA);

    expect(resultado.ok && resultado.rascunho.version).toBe(5);
    expect(inseridos).toHaveLength(1);
    expect(inseridos[0]).toMatchObject({ app_id: APP, version: 5, status: 'draft' });
  });
});

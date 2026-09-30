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
import { configInicial, type AppConfig } from '@storefy/config-schema';
import type { Database } from '@storefy/db';
import { garantirRascunho, salvarRascunho } from '@/lib/configs-servidor';
import { TEXTO_DO_CONFLITO } from '@/lib/rascunho';

const LOJA = '33333333-3333-4333-8333-333333333333';
const APP = '22222222-2222-4222-8222-222222222222';
const LIDA = '2026-09-30T12:00:00.123456+00:00';
const DEPOIS = '2026-09-30T12:00:01.654321+00:00';

interface Resposta {
  data: unknown;
  error: { message: string; code?: string } | null;
}

interface Banco {
  maior: Resposta;
  /** As leituras do rascunho, em ordem — a segunda é a de "leia de novo". */
  rascunhos: Resposta[];
  /** O que cada tentativa de criar o rascunho devolve (sem nada: grava). */
  insercoes?: Resposta[];
  /** O que cada tentativa de consertar o rascunho devolve (sem nada: grava). */
  regravacoes?: Resposta[];
}

const LOJA_NO_BANCO = {
  name: 'Oak Vintage',
  primary_url: 'https://oakvintage.com.br',
  shop_domain: 'oak-vintage.myshopify.com',
  platform: 'shopify',
};

function configDaLoja(nome: string, versao: number): AppConfig {
  return configInicial(
    {
      name: nome,
      url: 'https://oakvintage.com.br',
      shopDomain: 'oak-vintage.myshopify.com',
      platform: 'shopify',
    },
    versao,
  );
}

/** Um Supabase de mentira que responde em ordem e anota o que foi pedido. */
function falso(banco: Banco) {
  const inseridos: Record<string, unknown>[] = [];
  /** Os filtros de cada conserto: `[coluna, valor]`. */
  const consertos: [string, unknown][][] = [];
  const leiturasDoRascunho = [...banco.rascunhos];
  const insercoes = [...(banco.insercoes ?? [])];
  const regravacoes = [...(banco.regravacoes ?? [])];

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
                ? { data: LOJA_NO_BANCO, error: null }
                : tabela === 'apps'
                  ? { data: { id: APP }, error: null }
                  : colunas === 'version'
                    ? banco.maior
                    : (leiturasDoRascunho.shift() ?? { data: null, error: null }),
            ),
        };
        return cadeia;
      },
      insert: (linha: Record<string, unknown>) => {
        inseridos.push(linha);
        return {
          select: () => ({
            single: () =>
              Promise.resolve(insercoes.shift() ?? { data: { updated_at: DEPOIS }, error: null }),
          }),
        };
      },
      update: () => {
        const filtros: [string, unknown][] = [];
        consertos.push(filtros);
        const cadeia = {
          eq: (coluna: string, valor: unknown) => {
            filtros.push([coluna, valor]);
            return cadeia;
          },
          select: () => ({
            maybeSingle: () =>
              Promise.resolve(regravacoes.shift() ?? { data: { updated_at: DEPOIS }, error: null }),
          }),
        };
        return cadeia;
      },
    }),
  };

  return { cliente: cliente as unknown as SupabaseClient<Database>, inseridos, consertos };
}

const FORA_DO_AR = { data: null, error: { message: 'conexão perdida' } };
const NENHUMA_LINHA = { data: null, error: null };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('garantirRascunho', () => {
  it('leitura do rascunho que falha NÃO cria outro por cima', async () => {
    const { cliente, inseridos } = falso({
      maior: { data: { version: 4 }, error: null },
      rascunhos: [FORA_DO_AR],
    });

    const resultado = await garantirRascunho(cliente, LOJA);

    expect(resultado.ok).toBe(false);
    expect(inseridos).toEqual([]);
  });

  it('leitura da maior versão que falha também para tudo', async () => {
    const { cliente, inseridos } = falso({
      maior: FORA_DO_AR,
      rascunhos: [NENHUMA_LINHA],
    });

    expect((await garantirRascunho(cliente, LOJA)).ok).toBe(false);
    expect(inseridos).toEqual([]);
  });

  it('com as leituras em dia, o rascunho que existe é o que abre — com a revisão lida', async () => {
    const config = configDaLoja('Oak Vintage', 4);
    const { cliente, inseridos, consertos } = falso({
      maior: { data: { version: 4 }, error: null },
      rascunhos: [{ data: { version: 4, config, updated_at: LIDA }, error: null }],
    });

    const resultado = await garantirRascunho(cliente, LOJA);

    expect(resultado.ok && resultado.rascunho.version).toBe(4);
    expect(resultado.ok && resultado.rascunho.revisao).toBe(LIDA);
    expect(inseridos).toEqual([]);
    expect(consertos).toEqual([]);
  });

  it('sem rascunho de verdade, cria o próximo número', async () => {
    const { cliente, inseridos } = falso({
      maior: { data: { version: 4 }, error: null },
      rascunhos: [NENHUMA_LINHA],
    });

    const resultado = await garantirRascunho(cliente, LOJA);

    expect(resultado.ok && resultado.rascunho.version).toBe(5);
    expect(resultado.ok && resultado.rascunho.revisao).toBe(DEPOIS);
    expect(inseridos).toHaveLength(1);
    expect(inseridos[0]).toMatchObject({ app_id: APP, version: 5, status: 'draft' });
  });

  it('outro pedido criou o mesmo rascunho no mesmo instante: lê o dele, sem erro', async () => {
    const dele = configDaLoja('Oak Vintage', 5);
    const { cliente, inseridos } = falso({
      maior: { data: { version: 4 }, error: null },
      rascunhos: [
        NENHUMA_LINHA,
        { data: { version: 5, config: dele, updated_at: DEPOIS }, error: null },
      ],
      insercoes: [{ data: null, error: { message: 'duplicate key value', code: '23505' } }],
    });

    const resultado = await garantirRascunho(cliente, LOJA);

    expect(resultado.ok && resultado.rascunho.revisao).toBe(DEPOIS);
    expect(inseridos).toHaveLength(1);
  });

  it('a loja mudou de nome: o conserto só vale por cima da linha como foi lida', async () => {
    const { cliente, consertos } = falso({
      maior: { data: { version: 4 }, error: null },
      rascunhos: [
        {
          data: { version: 4, config: configDaLoja('Nome antigo', 4), updated_at: LIDA },
          error: null,
        },
      ],
    });

    const resultado = await garantirRascunho(cliente, LOJA);

    expect(resultado.ok && resultado.rascunho.config.store.name).toBe('Oak Vintage');
    expect(resultado.ok && resultado.rascunho.revisao).toBe(DEPOIS);
    expect(consertos).toHaveLength(1);
    expect(consertos[0]).toContainEqual(['updated_at', LIDA]);
  });

  it('o editor de outra aba gravou no meio do conserto: lê de novo e não apaga a gravação', async () => {
    const daOutraAba = configDaLoja('Nome antigo', 4);
    daOutraAba.theme.primary = '#1d4ed8';
    const { cliente, consertos } = falso({
      maior: { data: { version: 4 }, error: null },
      rascunhos: [
        {
          data: { version: 4, config: configDaLoja('Nome antigo', 4), updated_at: LIDA },
          error: null,
        },
        { data: { version: 4, config: daOutraAba, updated_at: DEPOIS }, error: null },
      ],
      regravacoes: [NENHUMA_LINHA],
    });

    const resultado = await garantirRascunho(cliente, LOJA);

    // O conserto da segunda leitura leva a cor que a outra aba gravou.
    expect(resultado.ok && resultado.rascunho.config.theme.primary).toBe('#1d4ed8');
    expect(resultado.ok && resultado.rascunho.config.store.name).toBe('Oak Vintage');
    expect(consertos).toHaveLength(2);
    expect(consertos[1]).toContainEqual(['updated_at', DEPOIS]);
  });

  it('quem só pode ler (a RLS não deixa consertar) ainda abre o rascunho consertado', async () => {
    const lido = {
      data: { version: 4, config: configDaLoja('Nome antigo', 4), updated_at: LIDA },
      error: null,
    };
    const { cliente, consertos } = falso({
      maior: { data: { version: 4 }, error: null },
      rascunhos: [lido, lido],
      regravacoes: [NENHUMA_LINHA, NENHUMA_LINHA],
    });

    const resultado = await garantirRascunho(cliente, LOJA);

    expect(resultado.ok && resultado.rascunho.config.store.name).toBe('Oak Vintage');
    // Nada foi gravado: a revisão continua a lida.
    expect(resultado.ok && resultado.rascunho.revisao).toBe(LIDA);
    expect(consertos).toHaveLength(2);
  });
});

/** Um Supabase de mentira só para a gravação: o UPDATE e a releitura dele. */
function falsoDaGravacao(gravacao: Resposta, releitura: Resposta = NENHUMA_LINHA) {
  const filtros: [string, unknown][] = [];
  const cliente = {
    from: () => ({
      update: () => {
        const cadeia = {
          eq: (coluna: string, valor: unknown) => {
            filtros.push([coluna, valor]);
            return cadeia;
          },
          select: () => ({ maybeSingle: () => Promise.resolve(gravacao) }),
        };
        return cadeia;
      },
      select: () => {
        const cadeia = { eq: () => cadeia, maybeSingle: () => Promise.resolve(releitura) };
        return cadeia;
      },
    }),
  };
  return { cliente: cliente as unknown as SupabaseClient<Database>, filtros };
}

describe('salvarRascunho', () => {
  const CONFIG = configDaLoja('Oak Vintage', 4);

  it('com a revisão, grava só por cima dela', async () => {
    const { cliente, filtros } = falsoDaGravacao({ data: { id: 'x' }, error: null });

    expect(await salvarRascunho(cliente, APP, 4, CONFIG, LIDA)).toEqual({ ok: true });
    expect(filtros).toContainEqual(['updated_at', LIDA]);
    expect(filtros).toContainEqual(['status', 'draft']);
  });

  it('sem a revisão (a loja recém-criada), grava sem esse filtro', async () => {
    const { cliente, filtros } = falsoDaGravacao({ data: { id: 'x' }, error: null });

    expect(await salvarRascunho(cliente, APP, 4, CONFIG)).toEqual({ ok: true });
    expect(filtros.map(([coluna]) => coluna)).not.toContain('updated_at');
  });

  it('outra gravação entrou antes: conflito, e nada é gravado', async () => {
    const { cliente } = falsoDaGravacao(NENHUMA_LINHA, {
      data: { updated_at: DEPOIS, status: 'draft' },
      error: null,
    });

    expect(await salvarRascunho(cliente, APP, 4, CONFIG, LIDA)).toEqual({
      ok: false,
      conflito: true,
      motivo: TEXTO_DO_CONFLITO,
    });
  });

  it('outra aba publicou esta versão no meio: também é conflito', async () => {
    const { cliente } = falsoDaGravacao(NENHUMA_LINHA, {
      data: { updated_at: LIDA, status: 'published' },
      error: null,
    });

    const resultado = await salvarRascunho(cliente, APP, 4, CONFIG, LIDA);
    expect(!resultado.ok && resultado.conflito).toBe(true);
  });

  it('a RLS filtrou (mesma revisão, ainda rascunho): não é conflito, é permissão', async () => {
    const { cliente } = falsoDaGravacao(NENHUMA_LINHA, {
      data: { updated_at: LIDA, status: 'draft' },
      error: null,
    });

    const resultado = await salvarRascunho(cliente, APP, 4, CONFIG, LIDA);
    expect(resultado.ok).toBe(false);
    expect(!resultado.ok && resultado.conflito).toBe(false);
    expect(!resultado.ok && resultado.motivo).toMatch(/permissão/);
  });

  it('o banco fora do ar na releitura não vira "conflito"', async () => {
    const { cliente } = falsoDaGravacao(NENHUMA_LINHA, FORA_DO_AR);

    const resultado = await salvarRascunho(cliente, APP, 4, CONFIG, LIDA);
    expect(!resultado.ok && resultado.conflito).toBe(false);
  });
});

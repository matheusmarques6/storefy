/**
 * `garantirSegredoDoApp`: o segredo nasce uma vez, e só uma.
 *
 * O caso que importa é a corrida — o build do iOS e o do Android da mesma
 * loja pedindo o segredo ao mesmo tempo. Quem perde tem de usar o do
 * vencedor; gravar por cima deixaria um dos dois binários sem conseguir falar
 * com o servidor.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { criptografar, descriptografar } from '@/lib/cripto';

const { garantirSegredoDoApp, gerarSegredoDeApp } = await import('@/lib/segredo-do-app');

const APP = '22222222-2222-4222-8222-222222222222';

interface Banco {
  /** O valor na coluna, que a gravação condicional confere. */
  coluna: string | null;
  /** Quem "chega antes" entre a leitura e a gravação desta chamada. */
  outroGravaAntes?: string;
  erroNaGravacao?: string;
  erroNaReleitura?: string;
  appSumiu?: boolean;
}

function falso(banco: Banco) {
  const gravacoes: { valor: string; condicao: string }[] = [];

  const cliente = {
    from: () => ({
      update: (valores: { device_secret_enc: string }) => {
        let condicao = '';
        const cadeia = {
          eq: (coluna: string, valor: unknown) => {
            if (coluna === 'device_secret_enc') condicao = `= ${String(valor)}`;
            return cadeia;
          },
          is: () => {
            condicao = 'is null';
            return cadeia;
          },
          select: () => {
            if (banco.erroNaGravacao !== undefined) {
              return Promise.resolve({ data: null, error: { message: banco.erroNaGravacao } });
            }
            if (banco.outroGravaAntes !== undefined) {
              banco.coluna = banco.outroGravaAntes;
              banco.outroGravaAntes = undefined;
            }
            const vale =
              condicao === 'is null'
                ? banco.coluna === null
                : `= ${String(banco.coluna)}` === condicao;
            if (!vale) return Promise.resolve({ data: [], error: null });
            banco.coluna = valores.device_secret_enc;
            gravacoes.push({ valor: valores.device_secret_enc, condicao });
            return Promise.resolve({ data: [{ id: APP }], error: null });
          },
        };
        return cadeia;
      },
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(
              banco.erroNaReleitura !== undefined
                ? { data: null, error: { message: banco.erroNaReleitura } }
                : {
                    data: banco.appSumiu === true ? null : { device_secret_enc: banco.coluna },
                    error: null,
                  },
            ),
        }),
      }),
    }),
  };

  return { cliente: cliente as unknown as SupabaseClient<Database>, gravacoes };
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('gerarSegredoDeApp', () => {
  it('32 bytes em base64url: nada que vire escape errado no caminho até o binário', () => {
    const segredo = gerarSegredoDeApp();
    expect(segredo).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(gerarSegredoDeApp()).not.toBe(segredo);
  });
});

describe('garantirSegredoDoApp', () => {
  it('app sem segredo: cria, grava cifrado só se a coluna ainda estiver vazia, e devolve em claro', async () => {
    const banco: Banco = { coluna: null };
    const { cliente, gravacoes } = falso(banco);

    const segredo = await garantirSegredoDoApp(cliente, APP, null);

    expect(segredo).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(gravacoes).toHaveLength(1);
    expect(gravacoes[0]?.condicao).toBe('is null');
    expect(gravacoes[0]?.valor).not.toContain(segredo);
    expect(descriptografar(banco.coluna ?? '')).toBe(segredo);
  });

  it('app com segredo: devolve o mesmo, sem gravar nada', async () => {
    const cifrado = criptografar('o-segredo-de-sempre');
    const { cliente, gravacoes } = falso({ coluna: cifrado });

    expect(await garantirSegredoDoApp(cliente, APP, cifrado)).toBe('o-segredo-de-sempre');
    expect(gravacoes).toEqual([]);
  });

  it('a corrida: o outro build grava primeiro, e este usa o segredo DELE', async () => {
    const doVencedor = criptografar('segredo-do-build-do-ios');
    const banco: Banco = { coluna: null, outroGravaAntes: doVencedor };
    const { cliente, gravacoes } = falso(banco);

    const segredo = await garantirSegredoDoApp(cliente, APP, null);

    expect(segredo).toBe('segredo-do-build-do-ios');
    expect(gravacoes).toEqual([]);
    expect(banco.coluna).toBe(doVencedor);
  });

  it('coluna vazia (texto em branco) conta como sem segredo', async () => {
    const banco: Banco = { coluna: '' };
    const { cliente, gravacoes } = falso(banco);

    const segredo = await garantirSegredoDoApp(cliente, APP, '');
    expect(gravacoes[0]?.condicao).toBe('= ');
    expect(descriptografar(banco.coluna ?? '')).toBe(segredo);
  });

  /*
   * Quase sempre é a ENCRYPTION_KEY errada neste servidor. Gerar outro
   * gravaria, com a chave errada, por cima do segredo bom — e derrubaria
   * todos os apps já instalados da loja.
   */
  it('segredo que não abre: falha alto, sem gerar outro por cima', async () => {
    const banco: Banco = { coluna: 'cifrado-com-outra-chave' };
    const { cliente, gravacoes } = falso(banco);

    await expect(garantirSegredoDoApp(cliente, APP, 'cifrado-com-outra-chave')).rejects.toThrow(
      /ENCRYPTION_KEY/,
    );
    expect(gravacoes).toEqual([]);
    expect(banco.coluna).toBe('cifrado-com-outra-chave');
  });

  it('banco fora do ar na gravação: falha, e o build fica na fila', async () => {
    const { cliente } = falso({ coluna: null, erroNaGravacao: 'conexão perdida' });
    await expect(garantirSegredoDoApp(cliente, APP, null)).rejects.toThrow(/conexão perdida/);
  });

  it('perdeu a corrida e o banco caiu na releitura: falha, sem inventar segredo', async () => {
    const { cliente } = falso({
      coluna: null,
      outroGravaAntes: criptografar('do-outro'),
      erroNaReleitura: 'conexão perdida',
    });
    await expect(garantirSegredoDoApp(cliente, APP, null)).rejects.toThrow(/reler/);
  });

  it('o app foi excluído no meio do caminho: falha', async () => {
    const { cliente } = falso({ coluna: null, outroGravaAntes: 'x', appSumiu: true });
    await expect(garantirSegredoDoApp(cliente, APP, null)).rejects.toThrow(/não existe mais/);
  });
});

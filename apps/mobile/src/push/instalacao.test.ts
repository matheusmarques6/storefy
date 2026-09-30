import { describe, expect, it } from 'vitest';
import { CHAVE_DA_INSTALACAO, lerOuCriarInstalacao, type DiscoDaInstalacao } from './instalacao.ts';

const UM = '3f6c1a2e-8d4b-4c7a-9e10-5b2f8a7c6d41';
const OUTRO = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

function disco(inicial: Record<string, string> = {}): DiscoDaInstalacao & {
  dados: Record<string, string>;
} {
  const dados = { ...inicial };
  return {
    dados,
    getItem: (chave) => Promise.resolve(dados[chave] ?? null),
    setItem: (chave, valor) => {
      dados[chave] = valor;
      return Promise.resolve();
    },
  };
}

describe('lerOuCriarInstalacao', () => {
  it('na primeira abertura, gera e guarda', async () => {
    const d = disco();
    await expect(lerOuCriarInstalacao(d, () => UM)).resolves.toBe(UM);
    expect(d.dados[CHAVE_DA_INSTALACAO]).toBe(UM);
  });

  it('nas outras, devolve o mesmo: é o mesmo aparelho, e não uma instalação nova', async () => {
    const d = disco({ [CHAVE_DA_INSTALACAO]: UM });
    await expect(lerOuCriarInstalacao(d, () => OUTRO)).resolves.toBe(UM);
  });

  it('o guardado fora do formato é trocado por um novo', async () => {
    const d = disco({ [CHAVE_DA_INSTALACAO]: 'lixo' });
    await expect(lerOuCriarInstalacao(d, () => OUTRO.toUpperCase())).resolves.toBe(OUTRO);
  });

  /*
   * Um identificador que não foi guardado mudaria a cada abertura, e cada
   * abertura contaria como uma instalação nova. Melhor nenhum.
   */
  it('sem conseguir ler ou guardar, não inventa um identificador', async () => {
    const semLer: DiscoDaInstalacao = {
      getItem: () => Promise.reject(new Error('disco')),
      setItem: () => Promise.resolve(),
    };
    await expect(lerOuCriarInstalacao(semLer, () => UM)).resolves.toBeNull();

    const semGuardar: DiscoDaInstalacao = {
      getItem: () => Promise.resolve(null),
      setItem: () => Promise.reject(new Error('cheio')),
    };
    await expect(lerOuCriarInstalacao(semGuardar, () => UM)).resolves.toBeNull();
  });

  it('gerador quebrado ou fora do formato também não vira identificador', async () => {
    await expect(
      lerOuCriarInstalacao(disco(), () => {
        throw new Error('sem gerador');
      }),
    ).resolves.toBeNull();
    await expect(lerOuCriarInstalacao(disco(), () => 'nao-e-uuid')).resolves.toBeNull();
  });
});

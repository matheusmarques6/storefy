import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registrarConfigEmbutida } from './registro-embutido';

const FONTE = readFileSync(join(import.meta.dirname, 'embutida.ts'), 'utf8');
const LOJA = '8f2c1a3e-3f65-4d7c-9a1f-2b6f5a1e9c01';

describe('registrarConfigEmbutida', () => {
  /*
   * O defeito: o workflow gravava `brands/<loja>/config.json`, e nada mais.
   * Sem a linha de `import`, o Metro não empacota o JSON, e o app da loja
   * saía sem config embutida — o primeiro uso sem internet abria em erro.
   */
  it('importa a config da loja e a põe no registro, com o id da loja como chave', () => {
    const nova = registrarConfigEmbutida(FONTE, LOJA);

    expect(nova).toContain(
      `import loja_8f2c1a3e_3f65_4d7c_9a1f_2b6f5a1e9c01 from '../../brands/${LOJA}/config.json';`,
    );
    expect(nova).toContain(`'${LOJA}': loja_8f2c1a3e_3f65_4d7c_9a1f_2b6f5a1e9c01,`);
    // A loja de desenvolvimento continua lá: o teste de `embutida` cobra
    // toda pasta de `brands/`.
    expect(nova).toContain("import oakvintage from '../../brands/oakvintage/config.json';");
  });

  it('as linhas novas ficam DENTRO dos marcadores, e o resto do arquivo não muda', () => {
    const nova = registrarConfigEmbutida(FONTE, LOJA);
    const semAsLinhas = nova
      .split('\n')
      .filter((linha) => !linha.includes('loja_8f2c1a3e'))
      .join('\n');

    expect(semAsLinhas).toBe(FONTE);
    expect(nova.indexOf(`'${LOJA}'`)).toBeGreaterThan(nova.indexOf('// registro:mapa:inicio'));
    expect(nova.indexOf(`'${LOJA}'`)).toBeLessThan(nova.indexOf('// registro:mapa:fim'));
  });

  it('rodar duas vezes não duplica nada: o workflow reexecutado é seguro', () => {
    const uma = registrarConfigEmbutida(FONTE, LOJA);
    expect(registrarConfigEmbutida(uma, LOJA)).toBe(uma);
  });

  it('recusa id que viraria outro caminho ou outro código', () => {
    for (const ruim of ['', '../outra', 'a b', "x'; process.exit(1); '", 'loja/../../x']) {
      expect(() => registrarConfigEmbutida(FONTE, ruim), ruim).toThrow();
    }
  });

  it('sem os marcadores, falha alto em vez de gerar um arquivo quebrado', () => {
    expect(() => registrarConfigEmbutida('export const x = 1;', LOJA)).toThrow(/marcadores/);
  });
});

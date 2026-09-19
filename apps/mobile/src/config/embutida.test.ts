import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeParseAppConfig } from '@storefy/config-schema';
import { CONFIGS_EMBUTIDAS, configEmbutida } from './embutida';

const PASTA_DAS_MARCAS = join(import.meta.dirname, '..', '..', 'brands');

function marcasNoDisco(): string[] {
  return readdirSync(PASTA_DAS_MARCAS, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .sort();
}

describe('configs embutidas', () => {
  it('toda pasta em brands/ está registrada', () => {
    // O Metro não resolve caminho dinâmico: uma pasta sem a linha de `import`
    // vira um app que abre sem config nenhuma, e só no aparelho.
    expect(Object.keys(CONFIGS_EMBUTIDAS).sort()).toEqual(marcasNoDisco());
  });

  it('há pelo menos uma marca, senão este teste não prova nada', () => {
    expect(marcasNoDisco().length).toBeGreaterThan(0);
  });

  it('toda config embutida passa no AppConfigSchema', () => {
    for (const [storeId, config] of Object.entries(CONFIGS_EMBUTIDAS)) {
      const analise = safeParseAppConfig(config);
      expect(analise.success, `${storeId}: ${analise.success ? '' : analise.error.message}`).toBe(
        true,
      );
    }
  });

  it('o registro carrega o mesmo JSON que está no disco', () => {
    // Um `import` de JSON some do bundle se o arquivo for movido; comparar com
    // o disco garante que o registro aponta para o arquivo de verdade.
    for (const storeId of marcasNoDisco()) {
      const doDisco: unknown = JSON.parse(
        readFileSync(join(PASTA_DAS_MARCAS, storeId, 'config.json'), 'utf8'),
      );
      expect(configEmbutida(storeId)).toEqual(doDisco);
    }
  });

  it('loja desconhecida devolve null em vez de estourar', () => {
    expect(configEmbutida('loja-que-nao-existe')).toBeNull();
    expect(configEmbutida('')).toBeNull();
    expect(configEmbutida('constructor')).toBeNull();
  });
});

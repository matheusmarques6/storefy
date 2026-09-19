/**
 * O `eas.json` é lido pelo EAS, não pelo TypeScript: um perfil renomeado ou um
 * campo trocado só aparece quando o build já está rodando na nuvem, minutos
 * depois. Estas asserções trazem esse erro para o CI.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Perfil {
  distribution?: string;
  developmentClient?: boolean;
  channel?: string;
  autoIncrement?: boolean;
}

interface EasJson {
  cli?: { appVersionSource?: string };
  build?: Record<string, Perfil>;
  submit?: Record<string, unknown>;
}

function lerEasJson(): EasJson {
  const caminho = join(import.meta.dirname, '..', '..', 'eas.json');
  return JSON.parse(readFileSync(caminho, 'utf8')) as EasJson;
}

describe('eas.json', () => {
  it('tem os três perfis do plano', () => {
    expect(Object.keys(lerEasJson().build ?? {}).sort()).toEqual([
      'development',
      'preview',
      'production',
    ]);
  });

  it('o perfil de desenvolvimento instala o dev client', () => {
    // Sem `developmentClient`, o build sai como app de produção e o
    // `expo start --dev-client` não tem onde conectar.
    const perfil = lerEasJson().build?.development;
    expect(perfil?.developmentClient).toBe(true);
    expect(perfil?.distribution).toBe('internal');
  });

  it('cada perfil tem o seu canal de update', () => {
    // Canais misturados fazem uma correção OTA de teste cair no app que já
    // está na mão do cliente.
    const build = lerEasJson().build ?? {};
    const canais = Object.entries(build).map(([nome, perfil]) => [nome, perfil.channel]);
    expect(canais).toEqual([
      ['development', 'development'],
      ['preview', 'preview'],
      ['production', 'production'],
    ]);
  });

  it('o EAS NÃO conta o número do build sozinho', () => {
    // Quem manda no número é a tabela `builds`, via IOS_BUILD e ANDROID_VC.
    // Com o EAS contando em paralelo, os dois divergem na primeira rejeição.
    expect(lerEasJson().build?.production?.autoIncrement).toBe(false);
    expect(lerEasJson().cli?.appVersionSource).toBe('local');
  });

  it('tem um perfil de envio para as lojas', () => {
    expect(lerEasJson().submit).toHaveProperty('production');
  });
});

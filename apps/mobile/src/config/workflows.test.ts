/**
 * O que os workflows passam ao `app.config.ts`.
 *
 * O build (`build-store-app.yml`) e a correção OTA (`ota-update.yml`) avaliam
 * o MESMO `app.config.ts`, e o manifesto de cada um vira o manifesto em uso
 * do app — o do binário até a primeira correção, o da correção depois. Uma
 * variável que só um dos dois passa cai no padrão de desenvolvimento no
 * aparelho do cliente, sem erro nenhum: foi assim que a correção OTA saía sem
 * a API da loja, sem o esquema de URL e sem o número da App Store, e morria
 * pedindo o ícone da loja, que o runner dela nunca baixou.
 *
 * Toda variável que o `app.config.ts` lê precisa estar classificada aqui. A
 * variável nova que ninguém classificou quebra este teste, e não o app.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = resolve(import.meta.dirname, '../../../..');
const ler = (caminho: string): string => readFileSync(resolve(RAIZ, caminho), 'utf8');

/** O app lê do manifesto EM USO: build e correção precisam passar igual. */
const DO_MANIFESTO = [
  'STORE_ID',
  'STOREFY_APP_ID',
  'API_BASE',
  'ONESIGNAL_APP_ID',
  'STOREFY_DEVICE_SECRET',
  'IOS_APP_STORE_ID',
  'EAS_PROJECT_ID',
  'EXPO_OWNER',
  'APP_SCHEME',
  'APP_NAME',
  'APP_SLUG',
  'IOS_BUNDLE_ID',
  'ANDROID_PACKAGE',
] as const;

/**
 * Do BINÁRIO: gravadas no build, lidas do próprio binário (`nucleo/ambiente.ts`)
 * ou só nativas. A correção não tem como acertá-las — serve a todos os
 * binários da loja de uma vez —, e o app não as lê do manifesto em uso.
 */
const DO_BINARIO = ['APP_VERSION', 'IOS_BUILD', 'ANDROID_VC', 'STORE_DOMAIN', 'SPLASH_BG'] as const;

/** Chaves de modo, e o que é só do desenvolvimento. */
const DE_MODO = ['PREVIEW_MODE', 'STOREFY_OTA', 'APNS_MODE'] as const;

/** As variáveis que o `app.config.ts` lê, onde quer que leia. */
function variaveisDoAppConfig(): string[] {
  const codigo = ler('apps/mobile/app.config.ts');
  const nomes = new Set<string>();
  for (const casou of codigo.matchAll(
    /(?:exigir|opcional|daLoja|identificador)\('([A-Z_]+)'|ambiente\['([A-Z_]+)'\]/g,
  )) {
    nomes.add(casou[1] ?? casou[2] ?? '');
  }
  return [...nomes].sort();
}

/** O texto de um passo do workflow, pelo nome. */
function passo(workflow: string, nome: string): string {
  const passos = ler(`.github/workflows/${workflow}`).split(/\n\s+- name: /);
  const achado = passos.find((texto) => texto.startsWith(`${nome}\n`));
  if (achado === undefined) throw new Error(`${workflow} não tem o passo "${nome}"`);
  return achado;
}

/** O passo entrega a variável: no `env:` dele ou num `export`. */
function entrega(texto: string, variavel: string): boolean {
  return (
    new RegExp(`^\\s+${variavel}: `, 'm').test(texto) ||
    new RegExp(`^\\s+export ${variavel}=`, 'm').test(texto)
  );
}

describe('as variáveis do app.config.ts', () => {
  it('toda variável lida tem classificação', () => {
    const classificadas = new Set<string>([...DO_MANIFESTO, ...DO_BINARIO, ...DE_MODO]);
    const soltas = variaveisDoAppConfig().filter((nome) => !classificadas.has(nome));
    expect(soltas, 'classifique a variável nova neste teste').toEqual([]);
  });

  it('nenhuma classificada sumiu do app.config.ts', () => {
    const lidas = new Set(variaveisDoAppConfig());
    const fantasmas = [...DO_MANIFESTO, ...DO_BINARIO, ...DE_MODO].filter(
      (nome) => !lidas.has(nome),
    );
    expect(fantasmas).toEqual([]);
  });
});

describe('build-store-app.yml', () => {
  const geracao = passo('build-store-app.yml', 'Gerar o binário');

  it('o passo do build entrega tudo que o app e o binário leem', () => {
    const faltando = [...DO_MANIFESTO, ...DO_BINARIO].filter(
      (variavel) => !entrega(geracao, variavel),
    );
    expect(faltando).toEqual([]);
  });

  /*
   * O `app.config.ts` é avaliado DE NOVO no servidor da EAS, e lá só existem
   * as variáveis do `env` do perfil. A que não vai para o `eas.json` volta ao
   * padrão dentro do binário.
   */
  it('e manda cada uma para o eas.json, que é o que o servidor da EAS enxerga', () => {
    const faltando = [...DO_MANIFESTO, ...DO_BINARIO].filter(
      (variavel) => !geracao.includes(`--arg ${variavel} "$${variavel}"`),
    );
    expect(faltando).toEqual([]);
  });

  it('um build de loja nunca é pacote de correção', () => {
    expect(entrega(geracao, 'STOREFY_OTA')).toBe(false);
  });
});

describe('ota-update.yml', () => {
  const publicacao = passo('ota-update.yml', 'Publicar a correção');

  it('a correção entrega tudo que o app lê do manifesto em uso', () => {
    const faltando = DO_MANIFESTO.filter((variavel) => !entrega(publicacao, variavel));
    expect(faltando).toEqual([]);
  });

  it('em modo de pacote: sem exigir a arte da loja, que é do binário', () => {
    expect(publicacao).toMatch(/^\s+export STOREFY_OTA=1$/m);
  });

  it('com a config da loja embutida, como no build', () => {
    const embutir = passo('ota-update.yml', 'Embutir a config da loja no pacote');
    expect(embutir).toContain("jq '.config' /tmp/loja.json");
    expect(embutir).toContain('registrar-config-embutida.ts');
  });
});

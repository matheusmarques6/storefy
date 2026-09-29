/**
 * Os fluxos do Maestro (`.maestro/`) contra o código do app.
 *
 * Os fluxos só rodam num simulador, e ninguém roda simulador a cada commit.
 * Sem este teste, trocar "Tentar de novo" por "Recarregar" quebraria o fluxo
 * offline em silêncio, e a quebra só apareceria no dia de rodar tudo antes de
 * um envio para a loja — quando ninguém lembra mais do porquê.
 *
 * Então: todo texto que um fluxo toca ou procura tem de existir no app, e todo
 * `id` tem de ser um `testID` do app ou um id de aba que `idDeTesteDaAba` gera.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { idDeTesteDaAba } from './config/abas';

const RAIZ = resolve(import.meta.dirname, '..');

function arquivos(pasta: string, extensoes: readonly string[]): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) achados.push(...arquivos(caminho, extensoes));
    else if (extensoes.some((extensao) => nome.endsWith(extensao))) achados.push(caminho);
  }
  return achados;
}

const FLUXOS = arquivos(join(RAIZ, '.maestro'), ['.yaml']);
const CODIGO = arquivos(join(RAIZ, 'src'), ['.ts', '.tsx'])
  .filter((arquivo) => !arquivo.endsWith('.test.ts'))
  .map((arquivo) => readFileSync(arquivo, 'utf8'))
  .join('\n');

/**
 * O que o app MOSTRA: textos entre aspas e texto de JSX. Comentário não
 * conta — um "Recarregar" num comentário não é um botão na tela.
 */
function textosDoApp(codigo: string): string[] {
  const achados: string[] = [];
  for (const casou of codigo.matchAll(
    /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g,
  )) {
    achados.push(casou[1] ?? casou[2] ?? casou[3] ?? '');
  }
  for (const casou of codigo.matchAll(/>([^<>{}]+)</g)) {
    achados.push((casou[1] ?? '').replace(/\s+/g, ' ').trim());
  }
  return achados.filter((texto) => texto !== '');
}

const TEXTOS_DO_APP = textosDoApp(
  // Sem os comentários de bloco e de linha, que também têm aspas soltas.
  CODIGO.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
);

function oAppMostra(pedaco: string): boolean {
  return TEXTOS_DO_APP.some((texto) => texto.includes(pedaco));
}

/** Os ids que a barra de abas gera, para os tipos que existem. */
const IDS_DAS_ABAS = new Set([
  ...(['cart', 'account', 'search', 'notifications'] as const).map((tipo) =>
    idDeTesteDaAba({ tipo }, 0),
  ),
  ...[0, 1, 2, 3, 4].map((indice) => idDeTesteDaAba({ tipo: 'webview' }, indice)),
]);

/** Um valor literal do YAML: sem variável `${...}`. */
function literal(valor: string): string | null {
  const limpo = valor.trim().replace(/^"(.*)"$/, '$1');
  return limpo.includes('${') ? null : limpo;
}

/** Os textos que os fluxos tocam ou procuram, e os ids. */
function alvos(yaml: string): { textos: string[]; ids: string[] } {
  const textos: string[] = [];
  const ids: string[] = [];
  for (const linha of yaml.split('\n')) {
    const texto =
      /^\s*-?\s*(?:tapOn|assertVisible|assertNotVisible|visible|notVisible|text):\s*(".*"|[^{\s].*)$/.exec(
        linha,
      )?.[1];
    if (texto !== undefined) {
      const valor = literal(texto);
      if (valor !== null) textos.push(valor);
    }
    const id = /^\s*id:\s*"(.+)"\s*$/.exec(linha)?.[1];
    if (id !== undefined) ids.push(id);
  }
  return { textos, ids };
}

/**
 * O texto do fluxo é uma expressão regular do Maestro ("Versão .*"): o que
 * importa é que cada pedaço fixo dela exista no código.
 */
function pedacosFixos(padrao: string): string[] {
  return padrao
    .split('.*')
    .map((pedaco) => pedaco.trim())
    .filter((pedaco) => pedaco !== '');
}

describe('fluxos do Maestro', () => {
  it('existem, e cada um diz para qual app roda', () => {
    expect(FLUXOS.length).toBeGreaterThanOrEqual(7);
    for (const fluxo of FLUXOS.filter((arquivo) => !arquivo.endsWith('config.yaml'))) {
      expect(readFileSync(fluxo, 'utf8'), fluxo).toMatch(/^appId: \$\{APP_ID\}$/m);
    }
  });

  it('todo texto que um fluxo toca ou procura existe no app', () => {
    const faltando: string[] = [];
    for (const fluxo of FLUXOS) {
      for (const texto of alvos(readFileSync(fluxo, 'utf8')).textos) {
        for (const pedaco of pedacosFixos(texto)) {
          if (!oAppMostra(pedaco)) faltando.push(`${fluxo}: "${pedaco}"`);
        }
      }
    }
    expect(faltando).toEqual([]);
  });

  it('todo id que um fluxo usa é um testID do app ou uma aba', () => {
    const faltando: string[] = [];
    for (const fluxo of FLUXOS) {
      for (const id of alvos(readFileSync(fluxo, 'utf8')).ids) {
        const noCodigo = CODIGO.includes(`testID="${id}"`);
        if (!noCodigo && !IDS_DAS_ABAS.has(id)) faltando.push(`${fluxo}: ${id}`);
      }
    }
    expect(faltando).toEqual([]);
  });

  it('o próprio teste pega um texto que o app não tem', () => {
    // Sem isto, um extrator quebrado passaria achando zero alvos.
    const { textos, ids } = alvos(
      '- tapOn: "Recarregar tudo"\n- assertVisible:\n    id: "nao-existe"\n',
    );
    expect(textos).toEqual(['Recarregar tudo']);
    expect(ids).toEqual(['nao-existe']);
    expect(oAppMostra('Recarregar tudo')).toBe(false);
    // E acha o que está numa tela de verdade.
    expect(oAppMostra('Tentar de novo')).toBe(true);
    expect(oAppMostra('Ajustes do app')).toBe(true);
  });
});

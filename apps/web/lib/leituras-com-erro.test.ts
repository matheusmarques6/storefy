/**
 * Varredura: leitura de tela, de rota e de loader que joga o erro do banco fora.
 *
 * `const { data } = await supabase...` sem olhar o `error` transforma "o banco
 * não respondeu" em "não existe": a tela diz "nenhuma campanha", "nunca
 * publicado", "loja não encontrada", e quem vê age em cima da mentira. Foi
 * assim que a tela de automações mostrou três automações sempre desligadas.
 *
 * A regra: nestes arquivos, toda leitura destrutura o `error` (e o trata) ou
 * passa por `lido()` (`lib/leitura.ts`). As ações de servidor (`acoes.ts`)
 * ficam de fora — nelas a falha já vira mensagem de erro para quem clicou,
 * nunca um sucesso falso.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = resolve(import.meta.dirname, '..');

function arquivos(pasta: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) achados.push(...arquivos(caminho));
    else achados.push(caminho);
  }
  return achados;
}

/** Os arquivos que LEEM para mostrar ou responder. */
function ehLeitura(caminho: string): boolean {
  const nome = caminho.split('/').at(-1) ?? '';
  if (nome.endsWith('.test.ts') || nome.endsWith('.test.tsx')) return false;
  if (caminho.startsWith('app/')) {
    return nome === 'page.tsx' || nome === 'layout.tsx' || nome === 'route.ts';
  }
  return /^lib\/([a-z-]+-servidor|contexto|visita)\.ts$/.test(caminho);
}

const ALVOS = [...arquivos(join(RAIZ, 'app')), ...arquivos(join(RAIZ, 'lib'))]
  .map((caminho) => relative(RAIZ, caminho))
  .filter(ehLeitura);

/** `const { data } = await` ou `const { data: x } = await`, sem `error`. */
const LEITURA_SEM_ERRO = /const\s*\{\s*data(?:\s*:\s*\w+)?\s*\}\s*=\s*await\b/g;
/** O mesmo para contagem. */
const CONTAGEM_SEM_ERRO = /const\s*\{\s*count(?:\s*:\s*\w+)?\s*\}\s*=\s*await\b/g;
/**
 * A mesma coisa dentro de `Promise.all`: `const [{ data: a }, { data: b }] =
 * await Promise.all([...])`. A primeira varredura não via esta forma, e ela
 * escondia 14 leituras — uma delas criava um rascunho novo por cima do que o
 * lojista vinha editando, quando a leitura do rascunho falhava.
 */
const LISTA_DO_PROMISE_ALL = /const\s*\[([^\]]*)\]\s*=\s*await\s+Promise\.all\b/g;
const ITEM_SEM_ERRO = /\{\s*(?:data|count)(?:\s*:\s*\w+)?\s*\}/g;

function achados(codigo: string): number[] {
  const linhas: number[] = [];
  const linhaDe = (indice: number) => codigo.slice(0, indice).split('\n').length;
  for (const padrao of [LEITURA_SEM_ERRO, CONTAGEM_SEM_ERRO]) {
    for (const casou of codigo.matchAll(padrao)) linhas.push(linhaDe(casou.index));
  }
  for (const lista of codigo.matchAll(LISTA_DO_PROMISE_ALL)) {
    const itens = lista[1] ?? '';
    const inicio = lista.index + lista[0].indexOf(itens);
    for (const item of itens.matchAll(ITEM_SEM_ERRO)) linhas.push(linhaDe(inicio + item.index));
  }
  return linhas;
}

describe('leituras que jogam o erro fora', () => {
  it('a varredura olha os arquivos certos', () => {
    // Sem isto, um filtro quebrado passaria achando zero arquivos.
    expect(ALVOS).toContain('lib/push-servidor.ts');
    expect(ALVOS).toContain('lib/contexto.ts');
    expect(ALVOS.some((caminho) => caminho.endsWith('/page.tsx'))).toBe(true);
    expect(ALVOS.some((caminho) => caminho.endsWith('/route.ts'))).toBe(true);
    expect(ALVOS.some((caminho) => caminho.endsWith('acoes.ts'))).toBe(false);
  });

  it('nenhuma tela, rota ou loader lê sem olhar o erro', () => {
    const problemas: string[] = [];
    for (const caminho of ALVOS) {
      const codigo = readFileSync(join(RAIZ, caminho), 'utf8');
      for (const linha of achados(codigo)) problemas.push(`${caminho}:${String(linha)}`);
    }
    expect(problemas).toEqual([]);
  });

  it('o padrão pega o defeito e deixa passar o certo', () => {
    expect(achados('const { data } = await supabase.from("x").select();')).toHaveLength(1);
    expect(achados('const { data: loja } = await servico.from("x");')).toHaveLength(1);
    expect(achados('const { count } = await servico.from("x");')).toHaveLength(1);
    expect(achados('const { data, error } = await supabase.from("x");')).toHaveLength(0);
    expect(
      achados('const { data: loja } = lido(await supabase.from("x"), "a loja");'),
    ).toHaveLength(0);
  });

  it('e dentro de Promise.all também', () => {
    expect(
      achados('const [{ data: a }, { data: b, error }] = await Promise.all([x, y]);'),
    ).toHaveLength(1);
    expect(
      achados('const [\n  { data },\n  { count: n },\n] = await Promise.all([x, y]);'),
    ).toEqual([2, 3]);
    expect(achados('const [lidaA, lidaB] = await Promise.all([x, y]);')).toHaveLength(0);
    expect(achados('const [{ data: a, error: erroA }] = await Promise.all([x]);')).toHaveLength(0);
  });
});

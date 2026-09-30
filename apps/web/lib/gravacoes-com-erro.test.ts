/**
 * Varredura: gravação no banco cujo resultado é jogado fora.
 *
 * `await supabase.from('x').update(...)` sem olhar o `error` faz o banco fora
 * do ar passar em silêncio: o build fica "gerando" para sempre, a trilha de
 * auditoria some, e — o pior — a campanha que a OneSignal já entregou
 * continua "enviando" e volta para a fila em 15 minutos, saindo de novo para
 * todos os clientes.
 *
 * A regra: toda gravação (`insert`, `update`, `delete`, `upsert`, `rpc`, e o
 * `remove`/`upload` do Storage) guarda o resultado e olha o `error`. O
 * resultado de propósito descartado precisa dizer por quê, com `void` e um
 * comentário.
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

/** O código sem os comentários, com as quebras de linha no lugar. */
function semComentarios(codigo: string): string {
  const branco = (trecho: string) => trecho.replace(/[^\n]/g, ' ');
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, branco)
    .replace(
      /(^|[^:'"`])\/\/[^\n]*/g,
      (trecho, antes: string) => antes + branco(trecho.slice(antes.length)),
    );
}

const GRAVACAO = /\.(?:insert|update|delete|upsert|rpc)\(|\.storage\b[\s\S]*\.(?:remove|upload)\(/;

/** O que vem logo depois do `await`: o client e a consulta, sem nada no meio. */
const CONSULTA_DIRETA = /^await\s+[\w$]+(?:\(\))?\s*\.\s*(?:from|rpc|storage)\b/;

/**
 * As linhas das instruções que começam com `await` sobre a consulta — o
 * resultado não vai para variável nenhuma — e gravam. Quem passa a consulta
 * para uma função que olha o erro (`anotar(..., supabase.rpc(...))`) não é
 * pego: o `await` ali é da função.
 */
function gravacoesSemErro(codigoComComentarios: string): number[] {
  const codigo = semComentarios(codigoComComentarios);
  const linhas: number[] = [];
  for (const casou of codigo.matchAll(/await\s/g)) {
    const inicio = casou.index;
    const comecoDaLinha = codigo.lastIndexOf('\n', inicio) + 1;
    if (codigo.slice(comecoDaLinha, inicio).trim() !== '') continue;
    if (!CONSULTA_DIRETA.test(codigo.slice(inicio))) continue;

    let profundidade = 0;
    let fim = inicio;
    for (; fim < codigo.length; fim += 1) {
      const caractere = codigo[fim];
      if (caractere === '(' || caractere === '[' || caractere === '{') profundidade += 1;
      else if (caractere === ')' || caractere === ']' || caractere === '}') {
        profundidade -= 1;
        if (profundidade < 0) break;
      } else if (caractere === ';' && profundidade === 0) break;
    }
    if (GRAVACAO.test(codigo.slice(inicio, fim))) {
      linhas.push(codigo.slice(0, inicio).split('\n').length);
    }
  }
  return linhas;
}

const ALVOS = [...arquivos(join(RAIZ, 'app')), ...arquivos(join(RAIZ, 'lib'))]
  .map((caminho) => relative(RAIZ, caminho))
  .filter((caminho) => /\.tsx?$/.test(caminho) && !/\.test\.tsx?$/.test(caminho));

describe('gravações que jogam o erro fora', () => {
  it('a varredura olha os arquivos certos', () => {
    expect(ALVOS).toContain('app/api/jobs/dispatch-push/route.ts');
    expect(ALVOS).toContain('lib/shopify-conexao.ts');
  });

  it('nenhuma gravação descarta o resultado', () => {
    const problemas: string[] = [];
    for (const caminho of ALVOS) {
      const codigo = readFileSync(join(RAIZ, caminho), 'utf8');
      for (const linha of gravacoesSemErro(codigo)) problemas.push(`${caminho}:${String(linha)}`);
    }
    expect(problemas).toEqual([]);
  });

  it('o padrão pega o defeito e deixa passar o certo', () => {
    expect(gravacoesSemErro("  await supabase.from('x').update({ a: 1 }).eq('id', 1);")).toEqual([
      1,
    ]);
    expect(gravacoesSemErro("  await servico.rpc('concluir', { p_id: 1 });")).toEqual([1]);
    expect(gravacoesSemErro("\n  await servico.storage.from('b').remove(['c']);")).toEqual([2]);
    expect(gravacoesSemErro("  const { error } = await supabase.from('x').insert({});")).toEqual(
      [],
    );
    expect(gravacoesSemErro("  await registrarBatimento('job', inicio);")).toEqual([]);
    expect(
      gravacoesSemErro("  await anotar(resumo, 'x', supabase.rpc('concluir', { p_id: 1 }));"),
    ).toEqual([]);
    expect(gravacoesSemErro("  await criarClientServiceRole().rpc('x', {});")).toEqual([1]);
    expect(
      gravacoesSemErro("  await servico\n    .from('builds')\n    .update({})\n    .eq('id', 1);"),
    ).toEqual([1]);
    expect(
      gravacoesSemErro("  const x = lido(await supabase.from('x').select('a'), 'x');"),
    ).toEqual([]);
    // Num comentário, o exemplo do defeito não é o defeito.
    expect(gravacoesSemErro("// await supabase.from('x').delete();")).toEqual([]);
  });
});

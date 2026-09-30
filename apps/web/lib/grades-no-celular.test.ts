/**
 * Varredura: grade que muda de colunas numa largura e não declara a do celular.
 *
 * Sem um `grid-cols-*` de base, a coluna do celular é a implícita, `auto`: ela
 * mede o conteúdo inteiro, e o texto que não quebra — o nome da loja com
 * `truncate`, o endereço sem espaço — alarga a grade além da tela, e a página
 * inteira rola para o lado. Foi o que o e2e do celular (`e2e/celular.spec.ts`)
 * mediu no início, nos detalhes da campanha e da automação e no composer.
 * `grid-cols-1` é `minmax(0, 1fr)`: a coluna cabe na tela, e o `truncate` corta.
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
    else if (caminho.endsWith('.tsx')) achados.push(caminho);
  }
  return achados;
}

/** As classes de cada grade de um arquivo, e se ela muda de colunas numa largura. */
function grades(codigo: string): { classes: string; semColunaDoCelular: boolean }[] {
  const achadas: { classes: string; semColunaDoCelular: boolean }[] = [];
  for (const [, classes = ''] of codigo.matchAll(/className="([^"]*)"/g)) {
    const lista = classes.split(/\s+/);
    if (!lista.includes('grid')) continue;
    const mudaNaLargura = lista.some((classe) => /^(sm|md|lg|xl|2xl):grid-cols-/.test(classe));
    const temBase = lista.some((classe) => classe.startsWith('grid-cols-'));
    achadas.push({ classes, semColunaDoCelular: mudaNaLargura && !temBase });
  }
  return achadas;
}

const TELAS = [...arquivos(join(RAIZ, 'app')), ...arquivos(join(RAIZ, 'components'))];

describe('grades no celular', () => {
  it('a varredura acha as grades (sem elas, passaria à toa)', () => {
    const total = TELAS.flatMap((caminho) => grades(readFileSync(caminho, 'utf8'))).length;
    expect(total).toBeGreaterThanOrEqual(40);
  });

  it('reconhece a grade sem a coluna do celular, e a que tem', () => {
    expect(grades('<div className="grid gap-4 sm:grid-cols-2">')).toEqual([
      { classes: 'grid gap-4 sm:grid-cols-2', semColunaDoCelular: true },
    ]);
    expect(grades('<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">')[0]).toMatchObject({
      semColunaDoCelular: false,
    });
    // A grade que não muda de colunas, e a que nem é grade, ficam de fora.
    expect(grades('<div className="grid gap-2">')[0]).toMatchObject({
      semColunaDoCelular: false,
    });
    expect(grades('<div className="flex sm:grid-cols-2">')).toEqual([]);
  });

  it('toda grade que muda de colunas numa largura declara a do celular', () => {
    const faltando = TELAS.flatMap((caminho) =>
      grades(readFileSync(caminho, 'utf8'))
        .filter((grade) => grade.semColunaDoCelular)
        .map((grade) => `${relative(RAIZ, caminho)}: "${grade.classes}"`),
    );
    expect(faltando).toEqual([]);
  });
});

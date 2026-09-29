/**
 * Toda página do admin se guarda sozinha.
 *
 * No App Router, o layout e a página renderizam EM PARALELO. O `redirect` do
 * layout manda o usuário comum embora — mas a página já está executando, e o
 * que ela faz acontece do mesmo jeito. Enquanto só o layout se guardava, um
 * usuário comum abrindo `/admin` fazia a A02 chamar `resumo_do_admin`, que
 * recusa com exceção: cada visita virava um erro 500 no log de produção, por
 * trás de um redirect que parecia funcionar.
 *
 * Não foi pego por nenhum teste de unidade, nem pela suíte de RLS — só pelo
 * e2e, na primeira vez que rodou contra um Supabase de verdade. Esta varredura
 * transforma isso em regra: uma página nova no admin sem a guarda derruba o
 * teste com o caminho dela.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAINEL = resolve(import.meta.dirname, '../app/(admin)/admin/(painel)');

function paginas(pasta: string): string[] {
  const achadas: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) achadas.push(...paginas(caminho));
    else if (nome === 'page.tsx') achadas.push(caminho);
  }
  return achadas;
}

describe('páginas do admin', () => {
  const todas = paginas(PAINEL);

  it('a varredura acha as páginas (senão o teste passaria calado)', () => {
    expect(todas.length).toBeGreaterThan(10);
  });

  it('toda página chama a guarda do admin', () => {
    const sem = todas
      .filter(
        (arquivo) =>
          !/await exigirPlatformAdmin(ComPapel)?\(\)/.test(readFileSync(arquivo, 'utf8')),
      )
      .map((arquivo) => relative(PAINEL, arquivo));

    expect(sem, 'páginas do admin sem guarda própria').toEqual([]);
  });

  /*
   * A guarda tem que vir ANTES de qualquer consulta. Depois de uma chamada ao
   * banco, ela protege a tela mas não a consulta — que é justamente o que
   * estourava.
   */
  it('a guarda vem antes da primeira consulta ao banco', () => {
    const fora = todas
      .filter((arquivo) => {
        const fonte = readFileSync(arquivo, 'utf8');
        const guarda = fonte.search(/await exigirPlatformAdmin(ComPapel)?\(\)/);
        const consulta = fonte.search(/\.(rpc|from)\(/);
        return consulta !== -1 && guarda > consulta;
      })
      .map((arquivo) => relative(PAINEL, arquivo));

    expect(fora, 'páginas que consultam o banco antes de se guardar').toEqual([]);
  });
});

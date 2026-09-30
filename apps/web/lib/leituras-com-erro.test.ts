/**
 * Varredura: leitura de tela, de rota e de loader que joga o erro do banco fora.
 *
 * `const { data } = await supabase...` sem olhar o `error` transforma "o banco
 * não respondeu" em "não existe": a tela diz "nenhuma campanha", "nunca
 * publicado", "loja não encontrada", e quem vê age em cima da mentira. Foi
 * assim que a tela de automações mostrou três automações sempre desligadas.
 *
 * A regra: nestes arquivos, toda leitura destrutura o `error` (e o trata) ou
 * passa por `lido()` (`lib/leitura.ts`).
 *
 * As ações de servidor (`acoes.ts`) ficavam de fora, na crença de que ali a
 * falha "já vira mensagem para quem clicou". Não vira: nelas a leitura
 * DECIDE. Com o banco fora, "há um build rodando?" dava "não" e disparava um
 * segundo build da mesma versão; "tem conta?" dava "não" e mandava convite de
 * cadastro para quem já tinha conta; "é superadmin?" dava "não" e deixava o
 * último superadmin excluir a conta; "já é cliente da Asaas?" dava "não" e
 * duplicava o pagador; e os limites de tentativas liberavam tudo. Agora elas
 * entram na varredura.
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

/**
 * Os arquivos que LEEM para mostrar ou responder: as telas, as rotas e TODO o
 * `lib/`. A primeira versão olhava só os `lib/*-servidor.ts`, e deixou passar
 * a lista das contas Apple e Google (dizia "nenhuma conta" com o banco fora),
 * o aviso de "falta configurar" das notificações e o `shop/redact`, que
 * respondia "apagado" à Shopify sem ter apagado nada.
 */
function ehLeitura(caminho: string): boolean {
  const nome = caminho.split('/').at(-1) ?? '';
  if (nome.endsWith('.test.ts') || nome.endsWith('.test.tsx')) return false;
  if (caminho.startsWith('app/')) {
    return (
      nome === 'page.tsx' || nome === 'layout.tsx' || nome === 'route.ts' || nome === 'acoes.ts'
    );
  }
  return /^lib\/.+\.tsx?$/.test(caminho);
}

/**
 * O código sem os comentários, com as quebras de linha no lugar: um exemplo
 * do defeito escrito num comentário (como o de `lib/leitura.ts`) não é o
 * defeito.
 */
function semComentarios(codigo: string): string {
  const branco = (trecho: string) => trecho.replace(/[^\n]/g, ' ');
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, branco)
    .replace(
      /(^|[^:'"`])\/\/[^\n]*/g,
      (trecho, antes: string) => antes + branco(trecho.slice(antes.length)),
    );
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

function achados(codigoComComentarios: string): number[] {
  const codigo = semComentarios(codigoComComentarios);
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
    expect(ALVOS).toContain('lib/contas-de-desenvolvedor.ts');
    expect(ALVOS).toContain('lib/shopify-webhook.ts');
    expect(ALVOS.some((caminho) => caminho.endsWith('/page.tsx'))).toBe(true);
    expect(ALVOS.some((caminho) => caminho.endsWith('/route.ts'))).toBe(true);
    // As ações de servidor também: nelas a leitura decide o que acontece.
    expect(ALVOS).toContain('app/(client)/(painel)/publicacao/acoes.ts');
    expect(ALVOS).toContain('app/(admin)/admin/(painel)/equipe/acoes.ts');
  });

  it('nenhuma tela, rota, ação ou loader lê sem olhar o erro', () => {
    const problemas: string[] = [];
    for (const caminho of ALVOS) {
      const codigo = readFileSync(join(RAIZ, caminho), 'utf8');
      for (const linha of achados(codigo)) problemas.push(`${caminho}:${String(linha)}`);
    }
    expect(problemas).toEqual([]);
  });

  it('o defeito escrito num comentário não é o defeito', () => {
    expect(achados('/**\n * `const { data } = await supabase...` joga fora\n */')).toHaveLength(0);
    expect(achados('// const { data } = await x;\nconst y = 1;')).toHaveLength(0);
    expect(achados('const url = "https://x"; const { data } = await y;')).toHaveLength(1);
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

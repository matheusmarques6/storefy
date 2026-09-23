/**
 * Parâmetros das listagens do admin: busca e paginação.
 *
 * Vive fora do componente para poder ser testado: os dois pontos abaixo já
 * geraram erro 400 ou consulta absurda em produtos parecidos.
 */

export const POR_PAGINA = 20;

/** Teto da página, para um número absurdo na URL não virar erro do banco. */
const PAGINA_MAXIMA = 100_000;

/** Teto do termo de busca, para não montar um LIKE gigante. */
const BUSCA_MAXIMA = 80;

export interface ParamsDeListagem {
  busca: string;
  pagina: number;
  de: number;
  ate: number;
}

/**
 * Lê e sanitiza `?q=` e `?pagina=`.
 *
 * A página é limitada: `?pagina=99999999999` viraria um offset maior do que um
 * integer do Postgres aguenta, e o PostgREST devolveria 400 em vez de uma
 * lista vazia.
 */
export function lerParams(params: { q?: string; pagina?: string }): ParamsDeListagem {
  const busca = normalizarBusca(params.q);

  const bruta = Number.parseInt(params.pagina ?? '1', 10);
  const pagina =
    Number.isFinite(bruta) && bruta > 0 ? Math.min(Math.trunc(bruta), PAGINA_MAXIMA) : 1;

  return { busca, pagina, de: (pagina - 1) * POR_PAGINA, ate: pagina * POR_PAGINA - 1 };
}

/** Termo de busca limpo, como o usuário deve vê-lo de volta no campo. */
export function normalizarBusca(bruta: string | undefined): string {
  return (bruta ?? '').trim().slice(0, BUSCA_MAXIMA);
}

/**
 * Prepara o termo para um filtro `ilike` do PostgREST.
 *
 * Duas coisas acontecem aqui:
 *
 *  - `,`, `(` e `)` são os separadores da sintaxe de filtro do PostgREST. Um
 *    termo com vírgula quebraria a cláusula `or` e o servidor devolveria 400 —
 *    o usuário veria uma tela de erro em vez de "nada encontrado".
 *  - `%` e `_` são curingas do LIKE. Sem escapar, buscar por `%` casaria com
 *    tudo, e buscar por `a_b` casaria `axb`. Escapamos para que a busca
 *    signifique o que está escrito.
 */
export function termoParaIlike(busca: string): string {
  return normalizarBusca(busca)
    .replace(/[,()]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/[%_]/g, (caractere) => `\\${caractere}`)
    .trim();
}

/** Total de páginas para o total de resultados informado. */
export function totalDePaginas(total: number): number {
  return Math.max(1, Math.ceil(total / POR_PAGINA));
}

/**
 * A URL de uma página da listagem.
 *
 * Mora aqui, e não dentro do componente, porque ela já errou: o componente
 * montava `${base}?${query}` na mão, e qualquer tela que passasse um `base`
 * com filtro — `/admin/builds?filtro=problema` — gerava
 * `/admin/builds?filtro=problema?pagina=2`, com DOIS pontos de interrogação.
 * O navegador lê isso como um filtro chamado `problema?pagina`, e a página 2
 * volta para a 1 sem dizer nada.
 *
 * `extras` são os filtros que precisam sobreviver à troca de página. Vêm antes
 * de `pagina` na query só para a URL ficar legível para quem a lê no chat do
 * suporte.
 */
export function montarUrlDePagina(
  base: string,
  {
    busca = '',
    pagina = 1,
    extras = {},
  }: { busca?: string; pagina?: number; extras?: Record<string, string> },
): string {
  // `base` pode vir com query — é o caso que quebrava. Separar e reaproveitar
  // é melhor do que proibir, porque a proibição só apareceria em produção.
  const [caminho, queryDaBase = ''] = base.split('?');
  const params = new URLSearchParams(queryDaBase);

  for (const [chave, valor] of Object.entries(extras)) {
    if (valor !== '') params.set(chave, valor);
  }
  if (busca !== '') params.set('q', busca);

  // Página 1 não entra na URL: é o padrão, e um `?pagina=1` pendurado faz duas
  // URLs diferentes mostrarem a mesma coisa.
  if (pagina > 1) params.set('pagina', String(pagina));
  else params.delete('pagina');

  const query = params.toString();
  return query === '' ? (caminho ?? base) : `${caminho ?? base}?${query}`;
}

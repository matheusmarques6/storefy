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

/**
 * Os números de um gráfico da C11, em tabela: o equivalente em texto do
 * desenho (WCAG 1.1.1) e o jeito de ler o número exato de um dia.
 *
 * Fechada por padrão, dentro de um `<details>` — aberta, ela é a mesma para
 * quem vê e para quem ouve.
 */
export function TabelaDoGrafico({
  titulo,
  colunas,
  linhas,
}: {
  titulo: string;
  colunas: readonly string[];
  linhas: readonly { dia: string; valores: readonly string[] }[];
}) {
  return (
    <details className="mt-3 text-sm">
      <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer">
        Ver os números em tabela
      </summary>
      {/* Rola por dentro com 90 dias; focável e com nome, para rolar pelo teclado. */}
      <div
        role="region"
        aria-label={titulo}
        tabIndex={0}
        className="focus-visible:ring-ring mt-2 max-h-72 overflow-y-auto rounded-lg border focus-visible:ring-2 focus-visible:outline-none"
      >
        <table className="w-full text-left tabular-nums">
          <caption className="sr-only">{titulo}</caption>
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Dia
              </th>
              {colunas.map((coluna) => (
                <th key={coluna} scope="col" className="px-3 py-2 text-right font-medium">
                  {coluna}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {linhas.map((linha) => (
              <tr key={linha.dia}>
                <th scope="row" className="px-3 py-1.5 font-normal">
                  {linha.dia}
                </th>
                {linha.valores.map((valor, indice) => (
                  <td key={colunas[indice]} className="px-3 py-1.5 text-right">
                    {valor}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

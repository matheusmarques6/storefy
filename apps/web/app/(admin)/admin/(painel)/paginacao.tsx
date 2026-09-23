import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { montarUrlDePagina, totalDePaginas } from '@/lib/listagem';

// A leitura e a sanitização dos parâmetros vivem em `@/lib/listagem`, que tem
// testes próprios. Aqui fica só o que desenha.
export { POR_PAGINA, lerParams } from '@/lib/listagem';

/** Paginação por links, para funcionar sem JavaScript e manter o filtro na URL. */
export function Paginacao({
  pagina,
  total,
  base,
  busca,
  extras,
}: {
  pagina: number;
  total: number;
  base: string;
  busca: string;
  /** Filtros que precisam sobreviver à troca de página (o recorte da A05). */
  extras?: Record<string, string>;
}) {
  const ultimaPagina = totalDePaginas(total);
  if (ultimaPagina <= 1) return null;

  const montar = (p: number) => montarUrlDePagina(base, { busca, pagina: p, extras });

  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-4 pt-2">
      <p className="text-muted-foreground text-sm">
        Página {pagina} de {ultimaPagina} · {total} {total === 1 ? 'resultado' : 'resultados'}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={pagina <= 1} asChild={pagina > 1}>
          {pagina > 1 ? (
            <Link href={montar(pagina - 1)}>
              <ChevronLeft aria-hidden />
              Anterior
            </Link>
          ) : (
            <span>
              <ChevronLeft aria-hidden />
              Anterior
            </span>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pagina >= ultimaPagina}
          asChild={pagina < ultimaPagina}
        >
          {pagina < ultimaPagina ? (
            <Link href={montar(pagina + 1)}>
              Próxima
              <ChevronRight aria-hidden />
            </Link>
          ) : (
            <span>
              Próxima
              <ChevronRight aria-hidden />
            </span>
          )}
        </Button>
      </div>
    </nav>
  );
}

/** Campo de busca. Envia por GET para o filtro viver na URL. */
export function CampoBusca({
  acao,
  valor,
  placeholder,
}: {
  acao: string;
  valor: string;
  placeholder: string;
}) {
  return (
    <form action={acao} className="flex gap-2">
      <input
        type="search"
        name="q"
        defaultValue={valor}
        placeholder={placeholder}
        aria-label={placeholder}
        className="border-input bg-background focus-visible:ring-ring h-10 w-full max-w-sm rounded-xl border px-3 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      />
      <Button type="submit" variant="outline">
        Buscar
      </Button>
    </form>
  );
}

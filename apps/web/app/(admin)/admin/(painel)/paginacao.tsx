import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const POR_PAGINA = 20;

/** Paginação por links, para funcionar sem JavaScript e manter o filtro na URL. */
export function Paginacao({
  pagina,
  total,
  base,
  busca,
}: {
  pagina: number;
  total: number;
  base: string;
  busca: string;
}) {
  const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (ultimaPagina <= 1) return null;

  const montar = (p: number) => {
    const params = new URLSearchParams();
    if (busca !== '') params.set('q', busca);
    if (p > 1) params.set('pagina', String(p));
    const query = params.toString();
    return query === '' ? base : `${base}?${query}`;
  };

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

/** Lê e sanitiza os parâmetros de busca e página. */
export function lerParams(params: { q?: string; pagina?: string }) {
  const busca = (params.q ?? '').trim();
  const bruta = Number.parseInt(params.pagina ?? '1', 10);
  const pagina = Number.isFinite(bruta) && bruta > 0 ? bruta : 1;
  return { busca, pagina, de: (pagina - 1) * POR_PAGINA, ate: pagina * POR_PAGINA - 1 };
}

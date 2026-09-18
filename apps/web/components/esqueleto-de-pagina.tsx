/**
 * Esqueletos de página, para os `loading.tsx` de cada rota.
 *
 * POR QUE ISSO EXISTE: sem um `loading.tsx`, o App Router mantém a tela
 * anterior congelada até o servidor terminar de buscar os dados. O usuário
 * clica e nada acontece — parece travado. Com ele, a estrutura da próxima tela
 * aparece na hora.
 *
 * Cada variante espelha o layout real da página correspondente. Isso é
 * deliberado: um esqueleto genérico provoca um salto de layout quando o
 * conteúdo chega, que incomoda mais do que a espera.
 *
 * Acessibilidade: o anúncio é feito UMA vez aqui, com `role="status"` e
 * `aria-live="polite"`. Os retângulos são `aria-hidden`, senão o leitor de
 * tela leria dezenas de elementos vazios.
 */
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

function Moldura({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('space-y-6', className)}>
      <span className="sr-only">Carregando…</span>
      {children}
    </div>
  );
}

function Cabecalho({ comAcao = false }: { comAcao?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      {comAcao ? <Skeleton className="h-10 w-32 rounded-xl" /> : null}
    </div>
  );
}

function LinhasDeTabela({ linhas = 5, colunas = 4 }: { linhas?: number; colunas?: number }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b px-4 py-3">
        <div className="flex gap-4">
          {Array.from({ length: colunas }, (_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
      </div>
      {Array.from({ length: linhas }, (_, linha) => (
        <div key={linha} className="border-b px-4 py-4 last:border-0">
          <div className="flex items-center gap-4">
            {Array.from({ length: colunas }, (_, coluna) => (
              <Skeleton key={coluna} className={cn('h-4', coluna === 0 ? 'w-40' : 'flex-1')} />
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}

/** Dashboard do cliente: cabeçalho, grade de cartões e o bloco de próximos passos. */
export function EsqueletoDePainel() {
  return (
    <Moldura className="space-y-8">
      <Cabecalho comAcao />
      <div className="space-y-4">
        <Skeleton className="h-4 w-24" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i}>
              <CardHeader className="space-y-3 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <Skeleton className="h-4 w-44" />
              </CardHeader>
              <CardContent className="flex items-center justify-between pt-0">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-8 w-16 rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Moldura>
  );
}

/** Páginas de listagem: cabeçalho, busca opcional e tabela. */
export function EsqueletoDeLista({
  comBusca = false,
  colunas = 4,
  linhas = 5,
}: {
  comBusca?: boolean;
  colunas?: number;
  linhas?: number;
}) {
  return (
    <Moldura>
      <Cabecalho comAcao={!comBusca} />
      {comBusca ? (
        <div className="flex gap-2">
          <Skeleton className="h-10 w-full max-w-sm rounded-xl" />
          <Skeleton className="h-10 w-24 rounded-xl" />
        </div>
      ) : null}
      <LinhasDeTabela linhas={linhas} colunas={colunas} />
    </Moldura>
  );
}

/** Formulário em cartão, com link de voltar acima. */
export function EsqueletoDeFormulario({ campos = 2 }: { campos?: number }) {
  return (
    <Moldura className="mx-auto max-w-xl space-y-6">
      <Skeleton className="h-4 w-36" />
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: campos }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-10 w-full rounded-xl" />
              <Skeleton className="h-3 w-52" />
            </div>
          ))}
          <Skeleton className="h-10 w-36 rounded-xl" />
        </CardContent>
      </Card>
    </Moldura>
  );
}

/** Páginas de configurações: uma pilha de cartões. */
export function EsqueletoDeConfiguracoes({ cartoes = 2 }: { cartoes?: number }) {
  return (
    <Moldura className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      {Array.from({ length: cartoes }, (_, i) => (
        <Card key={i}>
          <CardHeader className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-60" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-28 rounded-xl" />
          </CardContent>
        </Card>
      ))}
    </Moldura>
  );
}

/** Detalhe da organização no admin: resumo em grade e duas tabelas. */
export function EsqueletoDeDetalhe() {
  return (
    <Moldura>
      <Skeleton className="h-4 w-44" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <LinhasDeTabela linhas={3} colunas={4} />
      <LinhasDeTabela linhas={2} colunas={4} />
    </Moldura>
  );
}

import { cn } from '@/lib/utils';
import type * as React from 'react';

/**
 * Placeholder de carregamento. Nunca contém dado — só forma.
 *
 * `aria-hidden` porque a forma não significa nada para quem usa leitor de
 * tela: quem anuncia o carregamento é o `EsqueletoDePagina` em volta, uma vez,
 * em vez de dezenas de retângulos vazios.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div aria-hidden className={cn('bg-muted animate-pulse rounded-lg', className)} {...props} />
  );
}

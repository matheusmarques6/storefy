import { cn } from '@/lib/utils';
import type * as React from 'react';

/** Placeholder de carregamento. Nunca contém dado — só forma. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('bg-muted animate-pulse rounded-lg', className)} {...props} />;
}

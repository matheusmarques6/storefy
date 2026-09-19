/**
 * Campo de escolha.
 *
 * Usa o `<select>` do próprio navegador em vez do menu do Radix. No celular
 * isso vira a roleta nativa do sistema, que é mais rápida de usar com o polegar
 * e não briga com o teclado nem com o leitor de tela — e o lojista vai mexer no
 * editor do celular mais do que a gente gostaria de admitir.
 */
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        className={cn(
          'border-input bg-background ring-offset-background focus-visible:ring-ring aria-[invalid=true]:border-destructive h-10 w-full appearance-none rounded-xl border px-3 py-2 pr-9 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
      />
    </div>
  );
}

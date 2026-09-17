import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Estado vazio com CTA.
 *
 * Regra 1 das inegociáveis: quando não há dado, mostramos isto — nunca um
 * número fictício nem uma tabela de exemplo.
 */
export function EstadoVazio({
  icone: Icone,
  titulo,
  descricao,
  acao,
  className,
}: {
  icone: LucideIcon;
  titulo: string;
  descricao: string;
  acao?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-16 text-center',
        className,
      )}
    >
      <div className="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
        <Icone className="text-muted-foreground size-6" aria-hidden />
      </div>
      <h3 className="text-base font-semibold">{titulo}</h3>
      <p className="text-muted-foreground mt-1 max-w-md text-sm">{descricao}</p>
      {acao == null ? null : <div className="mt-6">{acao}</div>}
    </div>
  );
}

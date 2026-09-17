import type * as React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Campo de formulário com rótulo, erro e dica.
 * O erro é ligado ao input por aria-describedby, para leitor de tela anunciar.
 */
export function Campo({
  id,
  rotulo,
  erro,
  dica,
  children,
  className,
}: {
  id: string;
  rotulo: string;
  erro?: string | undefined;
  dica?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const idErro = `${id}-erro`;
  const idDica = `${id}-dica`;

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {dica == null ? null : (
        <p id={idDica} className="text-muted-foreground text-xs">
          {dica}
        </p>
      )}
      {erro == null || erro === '' ? null : (
        <p id={idErro} role="alert" className="text-destructive text-xs font-medium">
          {erro}
        </p>
      )}
    </div>
  );
}

/** Props de acessibilidade do input, ligadas ao erro e à dica do Campo. */
export function propsDoCampo(id: string, erro?: string, temDica = false) {
  const descritores = [
    erro != null && erro !== '' ? `${id}-erro` : null,
    temDica ? `${id}-dica` : null,
  ].filter((valor): valor is string => valor != null);

  return {
    id,
    name: id,
    'aria-invalid': erro != null && erro !== '',
    'aria-describedby': descritores.length > 0 ? descritores.join(' ') : undefined,
  } as const;
}

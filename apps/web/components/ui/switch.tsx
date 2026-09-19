'use client';

/**
 * Chave liga/desliga.
 *
 * É um `<button role="switch">` e não uma caixa de marcar: o estado muda na
 * hora, sem botão de salvar por perto, e `switch` é o papel que o leitor de
 * tela anuncia como "ligado/desligado" em vez de "marcado".
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

interface SwitchProps extends Omit<React.ComponentProps<'button'>, 'onChange'> {
  checked: boolean;
  onCheckedChange: (proximo: boolean) => void;
}

export function Switch({ checked, onCheckedChange, className, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        onCheckedChange(!checked);
      }}
      className={cn(
        'focus-visible:ring-ring inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'bg-background pointer-events-none block size-5 rounded-full shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

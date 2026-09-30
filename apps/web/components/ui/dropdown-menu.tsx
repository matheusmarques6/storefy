'use client';

import * as Primitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * O menu NÃO é modal por padrão (`modal={false}`), como pede o padrão de
 * botão de menu do WAI-ARIA: Esc fecha, Tab sai, e o resto da página continua
 * da pessoa. O modal do Radix marcava a página inteira com `aria-hidden`
 * enquanto o menu estava aberto, com os botões e links dela ainda focáveis —
 * o leitor de tela perdia a página, e a varredura de acessibilidade acusava.
 */
export function DropdownMenu({
  modal = false,
  ...props
}: React.ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root modal={modal} {...props} />;
}

export const DropdownMenuTrigger = Primitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn(
          'bg-popover text-popover-foreground z-50 min-w-[12rem] overflow-hidden rounded-xl border p-1 shadow-md',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        'focus:bg-accent focus:text-accent-foreground relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckItem({
  className,
  marcado,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.Item> & { marcado?: boolean }) {
  return (
    <DropdownMenuItem className={cn('justify-between', className)} {...props}>
      <span className="truncate">{children}</span>
      {marcado === true ? <Check className="size-4 shrink-0" aria-hidden /> : null}
    </DropdownMenuItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label
      className={cn('text-muted-foreground px-2 py-1.5 text-xs font-medium', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn('bg-muted -mx-1 my-1 h-px', className)} {...props} />;
}

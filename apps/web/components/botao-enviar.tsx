'use client';

import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';

/**
 * Botão de submit que desabilita e mostra progresso enquanto a Server Action
 * roda. Evita clique duplo, que criaria a mesma loja duas vezes.
 */
export function BotaoEnviar({
  children,
  carregando,
  ...props
}: ButtonProps & { carregando?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {carregando ?? 'Salvando...'}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

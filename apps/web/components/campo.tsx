import type * as React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Campo de formulário com rótulo, erro e dica.
 * O erro é ligado ao input por aria-describedby, para leitor de tela anunciar.
 *
 * COM ERRO, A DICA SAI. A dica orienta antes de a pessoa digitar; depois que
 * ela errou, o erro é a orientação — e é sempre a mais específica das duas.
 * Mostrar as duas repetia a mesma regra em duas frases, uma cinza e uma
 * vermelha ("Pelo menos 8 caracteres." em cima de "A senha precisa de pelo
 * menos 8 caracteres."), e o leitor de tela lia as duas em sequência. Quem
 * achou foi o e2e, na primeira vez que rodou contra um Supabase de verdade.
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
  const temErro = erro != null && erro !== '';

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
      {dica == null || temErro ? null : (
        <p id={idDica} className="text-muted-foreground text-xs">
          {dica}
        </p>
      )}
      {!temErro ? null : (
        <p id={idErro} role="alert" className="text-destructive text-xs font-medium">
          {erro}
        </p>
      )}
    </div>
  );
}

/**
 * Props de acessibilidade do input, ligadas ao erro e à dica do Campo.
 *
 * A dica só entra no `aria-describedby` quando NÃO há erro — porque é quando
 * ela existe na tela. Apontar para um id que não está no documento é o tipo de
 * defeito que nenhum olho vê e todo leitor de tela tropeça.
 */
export function propsDoCampo(id: string, erro?: string, temDica = false) {
  const temErro = erro != null && erro !== '';
  const descritores = [
    temErro ? `${id}-erro` : null,
    temDica && !temErro ? `${id}-dica` : null,
  ].filter((valor): valor is string => valor != null);

  return {
    id,
    name: id,
    'aria-invalid': temErro,
    'aria-describedby': descritores.length > 0 ? descritores.join(' ') : undefined,
  } as const;
}

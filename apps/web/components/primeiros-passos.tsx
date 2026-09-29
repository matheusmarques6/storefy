/**
 * O checklist dos primeiros passos (C04 e C05): o que já foi, o que falta e o
 * caminho de cada um. Os dados são os da tela de publicação, então o que está
 * marcado aqui é exatamente o que o botão de publicar enxerga.
 */
import Link from 'next/link';
import { CheckCircle2, Circle } from 'lucide-react';
import type { PassoInicial } from '@/lib/primeiros-passos';
import { Button } from '@/components/ui/button';

export function ListaDePrimeirosPassos({
  passos,
  podeAgir,
}: {
  passos: readonly PassoInicial[];
  /** Membro vê o progresso, mas os botões levariam a telas onde não pode mexer. */
  podeAgir: boolean;
}) {
  return (
    <ol className="divide-y rounded-lg border">
      {passos.map((passo) => (
        <li
          key={passo.chave}
          className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-start gap-3">
            {passo.feito ? (
              <CheckCircle2
                className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
            ) : (
              <Circle className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
            )}
            <div className="min-w-0">
              <p className={passo.feito ? 'text-muted-foreground text-sm' : 'text-sm font-medium'}>
                <span className="sr-only">{passo.feito ? 'Feito: ' : 'Falta: '}</span>
                {passo.titulo}
              </p>
              {passo.feito ? null : <p className="text-muted-foreground text-sm">{passo.porque}</p>}
            </div>
          </div>
          {passo.feito || !podeAgir ? null : (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="shrink-0 self-start sm:self-auto"
            >
              <Link href={passo.caminho}>{passo.acao}</Link>
            </Button>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * Os três passos do começo de uma loja: C02 (a loja), C03 (o visual) e C04
 * (no celular). Mostra onde a pessoa está, e que o cadastro já foi.
 */
import { Check } from 'lucide-react';

const PASSOS = [
  { chave: 'loja', rotulo: 'Loja' },
  { chave: 'visual', rotulo: 'Visual do app' },
  { chave: 'celular', rotulo: 'No seu celular' },
] as const;

export function PassosDoComeco({ atual }: { atual: 'visual' | 'celular' }) {
  const indiceAtual = PASSOS.findIndex((passo) => passo.chave === atual);

  return (
    <ol aria-label="Passos para começar" className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {PASSOS.map((passo, indice) => {
        const feito = indice < indiceAtual;
        const agora = indice === indiceAtual;
        return (
          <li
            key={passo.chave}
            aria-current={agora ? 'step' : undefined}
            className="flex items-center gap-2 text-sm"
          >
            <span
              className={
                feito
                  ? 'bg-primary text-primary-foreground border-primary flex size-6 items-center justify-center rounded-full border text-xs'
                  : agora
                    ? 'border-primary text-primary flex size-6 items-center justify-center rounded-full border-2 text-xs font-semibold'
                    : 'text-muted-foreground flex size-6 items-center justify-center rounded-full border text-xs'
              }
            >
              {feito ? <Check className="size-3.5" aria-hidden /> : indice + 1}
            </span>
            <span className={agora ? 'font-medium' : 'text-muted-foreground'}>
              {passo.rotulo}
              {feito ? <span className="sr-only"> (feito)</span> : null}
            </span>
            {indice < PASSOS.length - 1 ? (
              <span aria-hidden className="text-muted-foreground px-1">
                ›
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

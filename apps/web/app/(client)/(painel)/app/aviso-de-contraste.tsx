'use client';

/**
 * O aviso de contraste das cores do app (seção 10 do plano: contraste AA).
 * Usado no editor (C06a) e no começo (C03), onde a cor da marca é escolhida.
 * Um aviso, e não uma trava: a cor é do lojista — mas ele fica sabendo antes
 * do cliente, e da revisão.
 */
import { AlertTriangle } from 'lucide-react';
import type { AppConfig } from '@storefy/config-schema';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { problemasDeContraste, textoDaRazao } from '@/lib/contraste';

export function AvisoDeContraste({ tema }: { tema: AppConfig['theme'] }) {
  const problemas = problemasDeContraste(tema);
  if (problemas.length === 0) return null;

  return (
    <Alert data-testid="aviso-de-contraste">
      <AlertTriangle className="size-4" aria-hidden />
      <AlertTitle>Algumas cores ficam difíceis de ler</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          {problemas.map((problema) => (
            <li key={problema.onde}>
              {problema.onde}: contraste de {textoDaRazao(problema.razao)}, e o mínimo para ler bem
              é {textoDaRazao(problema.minimo)}.
              {problema.dica === null ? null : ` ${problema.dica}`}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

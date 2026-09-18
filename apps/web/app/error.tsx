'use client';

/**
 * Fronteira de erro da raiz.
 *
 * Pega o que escapa das fronteiras de segmento — as telas públicas e qualquer
 * erro fora dos painéis.
 */
import { EstadoDeErro } from '@/components/estado-de-erro';

export default function Erro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <EstadoDeErro erro={error} tentarDeNovo={reset} />
    </div>
  );
}

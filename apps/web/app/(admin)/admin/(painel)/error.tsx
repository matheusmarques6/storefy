'use client';

/** Erro dentro do painel admin, preservando a navegação do segmento. */
import { EstadoDeErro } from '@/components/estado-de-erro';

export default function ErroDoAdmin({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <EstadoDeErro
      erro={error}
      tentarDeNovo={reset}
      voltarPara="/admin"
      rotuloVoltar="Voltar para organizações"
    />
  );
}

'use client';

/**
 * Erro dentro do painel do cliente.
 *
 * Fica neste segmento de propósito: assim o cabeçalho, o seletor de loja e a
 * navegação continuam na tela, e a pessoa consegue ir para outro lugar em vez
 * de ficar presa numa página de erro em branco.
 */
import { EstadoDeErro } from '@/components/estado-de-erro';

export default function ErroDoPainel({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <EstadoDeErro erro={error} tentarDeNovo={reset} />;
}

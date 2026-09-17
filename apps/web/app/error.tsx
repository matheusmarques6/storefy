'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Fronteira de erro.
 *
 * Mostra a mensagem real em vez de um texto genérico: quase todo erro aqui é
 * acionável pelo usuário ("sem permissão", "sessão expirada") e esconder isso
 * só geraria um chamado de suporte.
 */
export default function Erro({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // O Sentry entra na Fase 8; por enquanto, o console do servidor já registra.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <Alert variant="destructive" className="max-w-lg text-left">
        <AlertCircle aria-hidden />
        <AlertDescription>
          {error.message === '' ? 'Algo deu errado. Tente novamente.' : error.message}
        </AlertDescription>
      </Alert>
      <div className="flex gap-2">
        <Button onClick={reset}>Tentar de novo</Button>
        <Button variant="outline" asChild>
          <Link href="/">Voltar para o início</Link>
        </Button>
      </div>
    </div>
  );
}

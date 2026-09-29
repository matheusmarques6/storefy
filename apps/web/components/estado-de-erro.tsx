'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { relatarNoNavegador } from '@/lib/erros-do-navegador';

/**
 * Estado de erro reutilizável (regra 7 do CLAUDE.md).
 *
 * Mostra a mensagem real em vez de um texto genérico: quase todo erro aqui é
 * acionável pelo usuário — "você não tem permissão", "sessão expirada" — e
 * esconder isso só geraria um chamado de suporte.
 */
export function EstadoDeErro({
  erro,
  tentarDeNovo,
  voltarPara = '/',
  rotuloVoltar = 'Voltar para o início',
}: {
  erro: Error & { digest?: string };
  tentarDeNovo: () => void;
  voltarPara?: string;
  rotuloVoltar?: string;
}) {
  useEffect(() => {
    console.error(erro);
    // Erro com `digest` veio do servidor, que já relatou; o resto quebrou só
    // aqui no navegador, e sem isto ninguém veria.
    relatarNoNavegador(erro, 'tela', window.location.pathname);
  }, [erro]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <Alert variant="destructive" className="max-w-lg text-left">
        <AlertCircle aria-hidden />
        <AlertDescription>
          {erro.message === '' ? 'Algo deu errado. Tente novamente.' : erro.message}
          {erro.digest == null ? null : (
            <span className="mt-2 block font-mono text-xs opacity-70">Código: {erro.digest}</span>
          )}
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={tentarDeNovo}>
          <RotateCcw aria-hidden />
          Tentar de novo
        </Button>
        <Button variant="outline" asChild>
          <Link href={voltarPara}>{rotuloVoltar}</Link>
        </Button>
      </div>
    </div>
  );
}

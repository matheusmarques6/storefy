'use client';

/**
 * Encerrar um build que parou no meio (A05), com confirmação.
 *
 * A confirmação diz o risco: se o build ainda estiver rodando na EAS (uma
 * fila cheia, só demorando), encerrá-lo aqui libera a loja para um segundo
 * build, que disputa o mesmo número de versão. Por isso o texto manda olhar os
 * logs antes.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, OctagonX } from 'lucide-react';
import { toast } from 'sonner';
import { marcarBuildParado } from './acoes';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function BotaoParado({ buildId, loja }: { buildId: string; loja: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [encerrando, iniciar] = useTransition();

  function encerrar() {
    iniciar(async () => {
      let resultado: Awaited<ReturnType<typeof marcarBuildParado>>;
      try {
        resultado = await marcarBuildParado(buildId);
      } catch {
        toast.error('Não conseguimos falar com o servidor. Tente de novo.');
        return;
      }
      setConfirmando(false);
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Build encerrado.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível encerrar.');
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={encerrando}
        onClick={() => {
          setConfirmando(true);
        }}
      >
        {encerrando ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <OctagonX className="size-4" aria-hidden />
        )}
        Encerrar
      </Button>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar o build parado de {loja}?</AlertDialogTitle>
            <AlertDialogDescription>
              O build vira “Falhou”, com o motivo para o lojista, e a loja pode publicar de novo.
              Antes, confira nos logs que ele não está rodando: se estiver só demorando, um build
              novo disputaria o mesmo número de versão na loja.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={encerrando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={encerrando}
              onClick={(evento) => {
                evento.preventDefault();
                encerrar();
              }}
            >
              {encerrando ? 'Encerrando…' : 'Encerrar build'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

'use client';

/**
 * Encerrar uma rodada de correção que parou no meio (A-OTA), com confirmação.
 *
 * A confirmação diz o risco: se o workflow ainda estiver rodando no GitHub (só
 * lento), encerrar aqui libera a próxima correção, e o GitHub a põe para
 * esperar esta. Por isso o texto manda conferir lá antes.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, OctagonX } from 'lucide-react';
import { toast } from 'sonner';
import { encerrarRodadaParada } from './acoes';
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

export function BotaoEncerrarRodada({ otaId }: { otaId: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [encerrando, iniciar] = useTransition();

  function encerrar() {
    iniciar(async () => {
      let resultado: Awaited<ReturnType<typeof encerrarRodadaParada>>;
      try {
        resultado = await encerrarRodadaParada(otaId);
      } catch {
        toast.error('Não conseguimos falar com o servidor. Tente de novo.');
        return;
      }
      setConfirmando(false);
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Rodada encerrada.');
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
            <AlertDialogTitle>Encerrar a rodada parada?</AlertDialogTitle>
            <AlertDialogDescription>
              Ela vira “Com falha” e libera a próxima correção. As lojas que já receberam ficam com
              ela. Antes, confira no GitHub (Actions › ota-update) que a execução não está mais
              rodando: se estiver só lenta, a próxima correção vai esperar ela terminar.
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
              {encerrando ? 'Encerrando…' : 'Encerrar rodada'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

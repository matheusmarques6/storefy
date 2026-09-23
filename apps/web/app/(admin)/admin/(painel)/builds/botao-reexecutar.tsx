'use client';

/**
 * O botão de reexecutar, com confirmação.
 *
 * A confirmação existe porque a ação CUSTA: cada build é cerca de meia hora de
 * máquina e um número de versão queimado na loja. Um clique sem querer numa
 * lista de trinta linhas é fácil, e não dá para desfazer.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { reexecutarBuild } from './acoes';
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

export function BotaoReexecutar({ buildId, loja }: { buildId: string; loja: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [rodando, iniciar] = useTransition();

  function reexecutar() {
    iniciar(async () => {
      const resultado = await reexecutarBuild(buildId);
      setConfirmando(false);

      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Build na fila.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível reexecutar.');
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={rodando}
        onClick={() => {
          setConfirmando(true);
        }}
      >
        {rodando ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <RotateCcw className="size-4" aria-hidden />
        )}
        Reexecutar
      </Button>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reexecutar o build de {loja}?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso gera um build NOVO com a mesma configuração, e leva de 15 a 30 minutos. O build
              que falhou continua no histórico do cliente — é o que explica o número de versão que
              foi pulado. Não dá para cancelar depois de começar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rodando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(evento) => {
                evento.preventDefault();
                reexecutar();
              }}
              disabled={rodando}
            >
              {rodando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Reexecutar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

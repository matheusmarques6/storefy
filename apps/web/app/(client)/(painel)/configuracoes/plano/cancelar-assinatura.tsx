'use client';

/**
 * C15 — cancelar a assinatura. A confirmação diz o que acontece, com a data:
 * o que já foi pago vale até o fim, o app segue no ar, e o que para é o que
 * custa. Cancelar sem saber disso é o tipo de clique que vira chamado.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cancelarAssinatura } from './acoes';
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

export function CancelarAssinatura({ liberadoAte }: { liberadoAte: string | null }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [rodando, iniciar] = useTransition();

  function cancelar() {
    iniciar(async () => {
      const resultado = await cancelarAssinatura();
      setAberto(false);
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Assinatura cancelada.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível cancelar.');
      }
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setAberto(true);
        }}
      >
        Cancelar assinatura
      </Button>
      <AlertDialog
        open={aberto}
        onOpenChange={(valor) => {
          if (!rodando) setAberto(valor);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a assinatura?</AlertDialogTitle>
            <AlertDialogDescription>
              Nenhuma fatura nova será gerada, e a fatura em aberto é cancelada.{' '}
              {liberadoAte === null
                ? 'Envio de campanhas, publicação de mudanças, versões novas e lojas novas param.'
                : `O que já foi pago vale até ${liberadoAte}; depois disso, envio de campanhas, publicação de mudanças, versões novas e lojas novas param.`}{' '}
              O app continua funcionando para os seus clientes, e dá para assinar de novo quando
              quiser.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rodando}>Manter assinatura</AlertDialogCancel>
            <AlertDialogAction
              disabled={rodando}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(evento) => {
                evento.preventDefault();
                cancelar();
              }}
            >
              {rodando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Cancelar assinatura
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

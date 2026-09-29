'use client';

/** A09 — excluir um plano que ninguém assinou, com confirmação. */
import { useState, useTransition } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { excluirPlano } from '../acoes';
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

export function ExcluirPlano({
  planoId,
  nome,
  bloqueado,
}: {
  planoId: string;
  nome: string;
  bloqueado: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [rodando, iniciar] = useTransition();

  function excluir() {
    iniciar(async () => {
      // Deu certo, a ação redireciona para a lista; aqui só chega a recusa.
      const resultado = await excluirPlano(planoId);
      setAberto(false);
      if (resultado.mensagem != null) toast.error(resultado.mensagem);
    });
  }

  return (
    <>
      <Button
        variant="outline"
        className="text-destructive"
        disabled={bloqueado}
        onClick={() => {
          setAberto(true);
        }}
      >
        <Trash2 aria-hidden />
        Excluir plano
      </Button>
      <AlertDialog
        open={aberto}
        onOpenChange={(valor) => {
          if (!rodando) setAberto(valor);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o plano {nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              Ele sai da vitrine dos lojistas e da lista. Não dá para desfazer; para voltar, crie o
              plano de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rodando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={rodando}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(evento) => {
                evento.preventDefault();
                excluir();
              }}
            >
              {rodando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Excluir plano
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

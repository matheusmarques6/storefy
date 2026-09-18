'use client';

import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { excluirLoja } from '../acoes';
import { ehControleDeFluxoDoNext, mensagemDeErro } from '@/lib/erros';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/**
 * Exclusão de loja, sempre atrás de confirmação (regra 3: ação destrutiva
 * precisa de confirmação). O texto diz o nome da loja para o usuário conferir
 * que está apagando a certa.
 */
export function ExcluirLoja({ lojaId, nome }: { lojaId: string; nome: string }) {
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    iniciar(() => {
      excluirLoja(lojaId).catch((erro: unknown) => {
        // `redirect()` do Next lança de propósito: a exclusão deu certo e a
        // navegação está a caminho. Mostrar erro aqui assustaria o usuário.
        if (ehControleDeFluxoDoNext(erro)) return;
        toast.error(mensagemDeErro(erro, 'Não foi possível excluir a loja.'));
      });
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="text-destructive hover:bg-destructive/10">
          <Trash2 aria-hidden />
          Excluir loja
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir “{nome}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta ação não pode ser desfeita. O app dessa loja e todas as configurações dele são
            apagados junto. As lojas das outras empresas não são afetadas.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pendente}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={pendente}
            onClick={(evento) => {
              // Mantém o diálogo aberto até a ação terminar, para o usuário ver
              // o erro caso a exclusão seja negada.
              evento.preventDefault();
              confirmar();
            }}
          >
            {pendente ? 'Excluindo...' : 'Sim, excluir'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

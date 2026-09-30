'use client';

import { useTransition } from 'react';
import { Trash2, TriangleAlert } from 'lucide-react';
import type { StoreStatus } from '@storefy/db';
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

/** Com o app na loja (ou a caminho dela), excluir aqui não o tira de lá. */
const APP_NAS_LOJAS: readonly StoreStatus[] = ['live', 'in_review', 'paused'];

/**
 * Exclusão de loja, sempre atrás de confirmação (regra 3: ação destrutiva
 * precisa de confirmação). O texto diz o nome da loja para o usuário conferir
 * que está apagando a certa — e, com o app nas lojas de aplicativos, avisa que
 * ele continua lá, parado.
 */
export function ExcluirLoja({
  lojaId,
  nome,
  status,
}: {
  lojaId: string;
  nome: string;
  status: StoreStatus;
}) {
  const noAr = APP_NAS_LOJAS.includes(status);
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
            apagados junto, e a Shopify para de mandar os pedidos dela para a Storefy.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {noAr ? (
          <div
            role="alert"
            className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              O app desta loja está na App Store ou na Play Store, e excluir aqui não o tira de lá.
              Quem já instalou continua com ele, mas o app para de receber a configuração, as
              notificações e as correções. Tire o app das lojas pelo App Store Connect e pelo Play
              Console.
            </p>
          </div>
        ) : null}
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

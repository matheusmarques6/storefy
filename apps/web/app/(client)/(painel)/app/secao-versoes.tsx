'use client';

/** Histórico de versões, com restaurar (C06f). */
import { useState, useTransition } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { VersaoDoHistorico } from '@/lib/configs-servidor';
import { Badge } from '@/components/ui/badge';
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
import { restaurarVersao } from './acoes';

const ROTULO_DO_STATUS: Record<VersaoDoHistorico['status'], string> = {
  draft: 'Rascunho',
  published: 'No ar',
  archived: 'Histórico',
};

function quando(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function SecaoVersoes({
  storeId,
  versoes,
  somenteLeitura,
}: {
  storeId: string;
  versoes: VersaoDoHistorico[];
  somenteLeitura: boolean;
}) {
  const [aRestaurar, setARestaurar] = useState<number | null>(null);
  const [processando, iniciar] = useTransition();

  function confirmar() {
    const versao = aRestaurar;
    if (versao === null) return;
    iniciar(() => {
      void restaurarVersao(storeId, versao).then((estado) => {
        setARestaurar(null);
        if (estado.ok === true) toast.success(estado.mensagem ?? 'Versão carregada no rascunho.');
        else toast.error(estado.mensagem ?? 'Não foi possível restaurar.');
      });
    });
  }

  if (versoes.length === 0) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-sm">
        Nenhuma versão ainda. A primeira aparece aqui assim que você publicar.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y rounded-xl border">
        {versoes.map((versao) => (
          <li key={versao.version} className="flex flex-wrap items-center gap-3 p-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Versão {versao.version}</span>
                <Badge variant={versao.status === 'published' ? 'default' : 'secondary'}>
                  {ROTULO_DO_STATUS[versao.status]}
                </Badge>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {versao.status === 'published'
                  ? `No ar desde ${quando(versao.publishedAt)}`
                  : versao.status === 'archived'
                    ? `Esteve no ar em ${quando(versao.publishedAt)}`
                    : `Criado em ${quando(versao.createdAt)}`}
              </p>
            </div>

            {versao.status === 'draft' || somenteLeitura ? null : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={processando}
                onClick={() => {
                  setARestaurar(versao.version);
                }}
              >
                <RotateCcw className="size-4" aria-hidden />
                Restaurar
              </Button>
            )}
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground mt-3 flex items-start gap-2 text-xs">
        <History className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Restaurar carrega a versão escolhida no rascunho. O app dos seus clientes só muda quando
        você publicar.
      </p>

      <AlertDialog
        open={aRestaurar !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setARestaurar(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar a versão {aRestaurar}?</AlertDialogTitle>
            <AlertDialogDescription>
              O rascunho atual será substituído pelo conteúdo dessa versão. O que está no ar
              continua igual até você publicar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={processando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={processando}
              onClick={(evento) => {
                evento.preventDefault();
                confirmar();
              }}
            >
              {processando ? 'Restaurando…' : 'Restaurar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

'use client';

/**
 * C16 — convites em aberto: reenviar (outro link, outro prazo) e cancelar.
 *
 * Reenviar mostra o link novo uma vez, como ao convidar. Cancelar pede
 * confirmação: o link que a pessoa tem na caixa de entrada deixa de valer.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { ROTULO_PAPEL, type MembershipRole } from '@storefy/db';
import { cancelarConvite, reenviarConvite } from './acoes';
import { Button } from '@/components/ui/button';
import { LinhaCopiavel } from '@/components/linha-copiavel';
import { PrazoDoConvite } from '@/components/prazo-do-convite';
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

export interface ConviteEmAberto {
  id: string;
  email: string;
  papel: MembershipRole;
  expiraEm: string;
}

export function ListaDeConvites({
  convites,
  podeGerir,
}: {
  convites: ConviteEmAberto[];
  podeGerir: boolean;
}) {
  const router = useRouter();
  const [cancelando, setCancelando] = useState<ConviteEmAberto | null>(null);
  const [linkNovo, setLinkNovo] = useState<{ id: string; link: string } | null>(null);
  const [rodando, iniciar] = useTransition();

  function reenviar(convite: ConviteEmAberto) {
    iniciar(async () => {
      const resultado = await reenviarConvite(convite.id);
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Convite reenviado.');
        setLinkNovo(resultado.link == null ? null : { id: convite.id, link: resultado.link });
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível reenviar.');
      }
    });
  }

  function cancelar() {
    if (cancelando === null) return;
    const alvo = cancelando;
    iniciar(async () => {
      const resultado = await cancelarConvite(alvo.id);
      setCancelando(null);
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Convite cancelado.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível cancelar.');
      }
    });
  }

  return (
    <>
      <ul className="divide-y">
        {convites.map((convite) => {
          return (
            <li key={convite.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium break-all">{convite.email}</p>
                  <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                    <span>{ROTULO_PAPEL[convite.papel]}</span>
                    <span aria-hidden>·</span>
                    <PrazoDoConvite expiraEm={convite.expiraEm} />
                  </p>
                </div>
                {podeGerir ? (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={rodando}
                      onClick={() => {
                        reenviar(convite);
                      }}
                    >
                      {rodando ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <Send aria-hidden />
                      )}
                      Reenviar
                      <span className="sr-only"> o convite de {convite.email}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={rodando}
                      onClick={() => {
                        setCancelando(convite);
                      }}
                    >
                      <X aria-hidden />
                      Cancelar
                      <span className="sr-only"> o convite de {convite.email}</span>
                    </Button>
                  </div>
                ) : null}
              </div>
              {linkNovo?.id === convite.id ? (
                <div className="space-y-1">
                  <p className="text-muted-foreground text-xs">Link novo (aparece só agora):</p>
                  <LinhaCopiavel valor={linkNovo.link} monoespacado />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <AlertDialog
        open={cancelando !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setCancelando(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar o convite de {cancelando?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              O link que a pessoa recebeu deixa de valer. Se mudar de ideia, é só convidar de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rodando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={rodando}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(evento) => {
                evento.preventDefault();
                cancelar();
              }}
            >
              {rodando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Cancelar convite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

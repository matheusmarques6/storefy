'use client';

/**
 * O checklist de uma plataforma, com o botão de publicar (C12).
 *
 * O botão só existe quando TUDO que a loja de aplicativos exige está pronto.
 * Um botão habilitado que falha depois de vinte minutos de build é pior do que
 * um botão ausente com a lista do que falta ao lado.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, ChevronRight, Circle, Loader2, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import {
  checklistDaPlataforma,
  podePublicar,
  type ItemDoChecklist,
  type Plataforma,
} from '@/lib/checklist-de-publicacao';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { publicarApp } from './acoes';

const NOME: Record<Plataforma, string> = {
  ios: 'App Store (iPhone)',
  android: 'Play Store (Android)',
};

export function ChecklistDaPlataforma({
  plataforma,
  itens,
  podeEscrever,
}: {
  plataforma: Plataforma;
  itens: readonly ItemDoChecklist[];
  podeEscrever: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, iniciar] = useTransition();

  const daPlataforma = checklistDaPlataforma(itens, plataforma);
  const liberado = podePublicar(itens, plataforma);

  function publicar() {
    iniciar(async () => {
      const resultado = await publicarApp(plataforma);
      setConfirmando(false);

      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Build na fila.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível publicar.');
      }
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{NOME[plataforma]}</CardTitle>
          <CardDescription>
            {liberado
              ? 'Tudo pronto. Publicar gera o binário e envia para a loja.'
              : 'Resolva os itens abaixo para liberar a publicação.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <ul className="space-y-2.5">
            {daPlataforma.map((item) => (
              <li key={item.chave} className="flex items-start gap-2.5 text-sm">
                {item.pronto ? (
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden
                  />
                ) : (
                  <Circle
                    className={
                      item.obrigatorio
                        ? 'text-destructive mt-0.5 size-4 shrink-0'
                        : 'text-muted-foreground mt-0.5 size-4 shrink-0'
                    }
                    aria-hidden
                  />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={item.pronto ? 'text-muted-foreground' : ''}>
                      {item.titulo}
                    </span>
                    {item.obrigatorio ? null : (
                      <span className="text-muted-foreground text-xs">(opcional)</span>
                    )}
                  </div>

                  {item.pronto ? null : (
                    <p className="text-muted-foreground text-xs">
                      {item.comoResolver}
                      {item.caminho === null ? null : (
                        <>
                          {' '}
                          <Link
                            href={item.caminho}
                            className="text-foreground inline-flex items-center gap-0.5 underline underline-offset-2"
                          >
                            Resolver
                            <ChevronRight className="size-3" aria-hidden />
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {liberado && podeEscrever ? (
            <Button
              type="button"
              disabled={enviando}
              onClick={() => {
                setConfirmando(true);
              }}
            >
              {enviando ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Rocket className="size-4" aria-hidden />
              )}
              Publicar na {plataforma === 'ios' ? 'App Store' : 'Play Store'}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publicar na {NOME[plataforma]}?</AlertDialogTitle>
            <AlertDialogDescription>
              Vamos gerar o binário a partir da configuração publicada e enviar para a sua conta.
              {plataforma === 'ios'
                ? ' A Apple costuma levar de um a três dias para revisar.'
                : ' O Google costuma levar algumas horas.'}{' '}
              Você acompanha o andamento aqui mesmo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enviando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(evento) => {
                evento.preventDefault();
                publicar();
              }}
              disabled={enviando}
            >
              {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Publicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

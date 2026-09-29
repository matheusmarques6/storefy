'use client';

/**
 * Convites da plataforma em aberto (A03: lojistas; A11: equipe), e o
 * formulário de convidar lojista.
 *
 * O link aparece uma vez só — ao convidar e ao reenviar —, porque o banco
 * guarda apenas o hash do segredo.
 */
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import type { PlatformAdminRole } from '@storefy/db';
import { ROTULO_PAPEL_NA_PLATAFORMA } from '@/lib/convites';
import {
  cancelarConviteDaPlataforma,
  convidarLojista,
  reenviarConviteDaPlataforma,
  type EstadoDoConviteDaPlataforma,
} from './acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';
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

export interface ConviteDaPlataforma {
  id: string;
  email: string;
  papelNaPlataforma: PlatformAdminRole | null;
  expiraEm: string;
  convidadoPor: string | null;
}

export function FormularioConviteDeLojista({ emailConfigurado }: { emailConfigurado: boolean }) {
  const router = useRouter();
  const [estado, acao] = useActionState<EstadoDoConviteDaPlataforma, FormData>(
    async (anterior, dados) => {
      const resultado = await convidarLojista(anterior, dados);
      if (resultado.ok === true) router.refresh();
      return resultado;
    },
    {},
  );

  return (
    <form action={acao} className="space-y-4" noValidate>
      {estado.mensagem == null ? null : (
        <Alert variant={estado.ok === true ? 'info' : 'destructive'}>
          {estado.ok === true ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
          <AlertDescription>{estado.mensagem}</AlertDescription>
        </Alert>
      )}
      {estado.ok === true && estado.link != null ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Link do convite (aparece só agora):</p>
          <LinhaCopiavel valor={estado.link} monoespacado />
        </div>
      ) : null}

      <Campo
        id="email-lojista"
        rotulo="E-mail do lojista"
        erro={estado.erros?.email}
        dica="A pessoa cria a conta com este e-mail, mesmo com o cadastro fechado."
      >
        <Input
          {...propsDoCampo('email-lojista', estado.erros?.email, true)}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          placeholder="contato@lojapiloto.com.br"
          defaultValue={estado.valores?.email}
        />
      </Campo>

      {emailConfigurado ? null : (
        <p className="text-muted-foreground text-xs">
          O envio de e-mail não está configurado (A13). Depois de convidar, copie o link e mande
          para o lojista.
        </p>
      )}

      <BotaoEnviar carregando="Convidando...">Convidar lojista</BotaoEnviar>
    </form>
  );
}

export function ConvitesDaPlataforma({
  convites,
  podeGerir,
  vazio,
}: {
  convites: ConviteDaPlataforma[];
  podeGerir: boolean;
  vazio: string;
}) {
  const router = useRouter();
  const [cancelando, setCancelando] = useState<ConviteDaPlataforma | null>(null);
  const [linkNovo, setLinkNovo] = useState<{ id: string; link: string } | null>(null);
  const [rodando, iniciar] = useTransition();

  if (convites.length === 0) {
    return <p className="text-muted-foreground text-sm">{vazio}</p>;
  }

  function reenviar(convite: ConviteDaPlataforma) {
    iniciar(async () => {
      const resultado = await reenviarConviteDaPlataforma(convite.id);
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
      const resultado = await cancelarConviteDaPlataforma(alvo.id);
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
            <li key={convite.id} className="space-y-3 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-sm">
                  <p className="font-medium break-all">{convite.email}</p>
                  <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                    {convite.papelNaPlataforma == null ? null : (
                      <>
                        <span>{ROTULO_PAPEL_NA_PLATAFORMA[convite.papelNaPlataforma]}</span>
                        <span aria-hidden>·</span>
                      </>
                    )}
                    <PrazoDoConvite expiraEm={convite.expiraEm} />
                    {convite.convidadoPor == null ? null : (
                      <>
                        <span aria-hidden>·</span>
                        <span>por {convite.convidadoPor}</span>
                      </>
                    )}
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
              O link que a pessoa recebeu deixa de valer. Dá para convidar de novo depois.
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

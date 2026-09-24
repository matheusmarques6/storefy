'use client';

/**
 * As ações da A11: convidar, mudar papel e remover.
 *
 * Remover pede confirmação; mudar papel não. A diferença não é de gosto: tirar
 * alguém da equipe apaga um acesso que só outro superadmin devolve, e trocar
 * o papel é um clique que se desfaz com outro clique.
 *
 * Quem não é superadmin não vê nada disto — e o servidor recusa de novo, caso
 * alguém chegue por outro caminho.
 */
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, UserMinus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { PlatformAdminRole } from '@storefy/db';
import { ROTULO_PAPEL_ADMIN } from '@/lib/equipe-admin';
import { convidarAdmin, mudarPapelDoAdmin, removerAdmin, type EstadoDaEquipe } from './acoes';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';
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

export function Convidar() {
  const router = useRouter();

  const [estado, enviar, enviando] = useActionState<EstadoDaEquipe, FormData>(
    async (anterior, dados) => {
      const resultado = await convidarAdmin(anterior, dados);

      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Pessoa adicionada.');
        router.refresh();
      } else if (resultado.mensagem != null) {
        toast.error(resultado.mensagem);
      }
      return resultado;
    },
    {},
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Adicionar alguém à equipe</CardTitle>
        <CardDescription>
          A pessoa precisa já ter uma conta na Storefy. Adicionar aqui dá a ela acesso ao painel que
          enxerga todos os clientes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={enviar} className="space-y-4" noValidate>
          <Campo id="email" rotulo="E-mail" dica="O mesmo com que ela entra na Storefy.">
            <Input
              {...propsDoCampo('email', undefined, true)}
              type="email"
              placeholder="pessoa@convertfy.me"
              autoComplete="off"
              spellCheck={false}
            />
          </Campo>

          <Campo id="papel" rotulo="Papel" dica="Suporte vê tudo, mas não altera a equipe.">
            <select
              {...propsDoCampo('papel', undefined, true)}
              defaultValue="support"
              className="border-input bg-background focus-visible:ring-ring h-10 w-full rounded-xl border px-3 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <option value="support">Suporte</option>
              <option value="superadmin">Superadmin</option>
            </select>
          </Campo>

          {estado.ok !== true && estado.mensagem != null ? (
            <p className="text-destructive text-sm" role="alert">
              {estado.mensagem}
            </p>
          ) : null}

          <Button type="submit" disabled={enviando}>
            {enviando ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <UserPlus className="size-4" aria-hidden />
            )}
            Adicionar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function AcoesDaLinha({
  userId,
  email,
  papel,
}: {
  userId: string;
  email: string;
  papel: PlatformAdminRole;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, iniciar] = useTransition();

  const outroPapel: PlatformAdminRole = papel === 'superadmin' ? 'support' : 'superadmin';

  function rodar(acao: () => Promise<EstadoDaEquipe>, sucesso: string) {
    iniciar(async () => {
      const resultado = await acao();
      setConfirmando(false);

      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? sucesso);
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível.');
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={ocupado}
        onClick={() => {
          rodar(async () => mudarPapelDoAdmin(userId, outroPapel), 'Papel alterado.');
        }}
      >
        Tornar {ROTULO_PAPEL_ADMIN[outroPapel].toLowerCase()}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={ocupado}
        onClick={() => {
          setConfirmando(true);
        }}
      >
        {ocupado ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <UserMinus className="size-4" aria-hidden />
        )}
        Remover
      </Button>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogTitle>Remover {email} da equipe?</AlertDialogTitle>
          <AlertDialogHeader>
            <AlertDialogDescription>
              Ela perde o acesso ao painel que enxerga todos os clientes. A conta dela na Storefy
              continua existindo. Só outro superadmin consegue devolver esse acesso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ocupado}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(evento) => {
                evento.preventDefault();
                rodar(async () => removerAdmin(userId), 'Pessoa removida.');
              }}
              disabled={ocupado}
            >
              {ocupado ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

'use client';

/**
 * As ações da A11: convidar, mudar papel, remover e redefinir o segundo fator.
 *
 * Remover e redefinir pedem confirmação; mudar papel não. A diferença não é
 * de gosto: tirar alguém da equipe apaga um acesso que só outro superadmin
 * devolve, redefinir derruba as sessões da pessoa e a obriga a cadastrar o app
 * de novo, e trocar o papel é um clique que se desfaz com outro clique.
 *
 * Quem não é superadmin não vê nada disto — e o servidor recusa de novo, caso
 * alguém chegue por outro caminho.
 */
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, UserMinus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { PlatformAdminRole } from '@storefy/db';
import { ROTULO_PAPEL_ADMIN } from '@/lib/equipe-admin';
import {
  convidarAdmin,
  mudarPapelDoAdmin,
  redefinirSegundoFatorDoAdmin,
  removerAdmin,
  type EstadoDaEquipe,
} from './acoes';
import { valoresDigitados, type ValoresDigitados } from '@/lib/validacao';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';
import { LinhaCopiavel } from '@/components/linha-copiavel';
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

  const [estado, enviar, enviando] = useActionState<
    EstadoDaEquipe & { valores?: ValoresDigitados },
    FormData
  >(async (anterior, dados) => {
    const resultado = await convidarAdmin(anterior, dados);

    if (resultado.ok === true) {
      toast.success(resultado.mensagem ?? 'Pessoa adicionada.');
      router.refresh();
      // Com link (a pessoa ainda não tinha conta), a mensagem e o link ficam
      // na tela: o link só aparece esta vez.
      return { ...resultado, valores: {} };
    }
    if (resultado.mensagem != null) toast.error(resultado.mensagem);
    // Recusado, o e-mail e o papel escolhidos continuam no formulário.
    return { ...resultado, valores: valoresDigitados(dados, ['email', 'papel']) };
  }, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Adicionar alguém à equipe</CardTitle>
        <CardDescription>
          Dá acesso ao painel que enxerga todos os clientes. Quem já tem conta entra na equipe na
          hora; quem ainda não tem recebe um convite para criar a conta (vale mesmo com o cadastro
          fechado) e já nasce na equipe.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={enviar} className="space-y-4" noValidate>
          <Campo id="email" rotulo="E-mail" dica="O mesmo com que ela entra na Storefy.">
            <Input
              {...propsDoCampo('email', undefined, true)}
              defaultValue={estado.valores?.email}
              type="email"
              placeholder="pessoa@convertfy.me"
              autoComplete="off"
              spellCheck={false}
            />
          </Campo>

          <Campo id="papel" rotulo="Papel" dica="Suporte vê tudo, mas não altera a equipe.">
            {/*
              `key` pelo papel devolvido: num `<select>` o React só aplica o
              `defaultValue` ao montar, e sem remontar a limpeza do fim da
              ação voltaria para "Suporte" — quem escolheu superadmin e errou
              o e-mail adicionaria a pessoa com o papel errado no envio seguinte.
            */}
            <select
              key={estado.valores?.papel ?? 'support'}
              {...propsDoCampo('papel', undefined, true)}
              defaultValue={estado.valores?.papel ?? 'support'}
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

          {estado.ok === true && estado.link != null ? (
            <div className="space-y-1" role="status">
              <p className="text-sm">{estado.mensagem}</p>
              <p className="text-muted-foreground text-xs">Link do convite (aparece só agora):</p>
              <LinhaCopiavel valor={estado.link} monoespacado />
            </div>
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
  podeRedefinir,
}: {
  userId: string;
  email: string;
  papel: PlatformAdminRole;
  /** A pessoa tem o app autenticador ativo — e há o que redefinir. */
  podeRedefinir: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [redefinindo, setRedefinindo] = useState(false);
  const [ocupado, iniciar] = useTransition();

  const outroPapel: PlatformAdminRole = papel === 'superadmin' ? 'support' : 'superadmin';

  function rodar(acao: () => Promise<EstadoDaEquipe>, sucesso: string) {
    iniciar(async () => {
      const resultado = await acao();
      setConfirmando(false);
      setRedefinindo(false);

      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? sucesso);
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível.');
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
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

      {podeRedefinir ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={ocupado}
          onClick={() => {
            setRedefinindo(true);
          }}
        >
          <KeyRound className="size-4" aria-hidden />
          Redefinir verificação
        </Button>
      ) : null}

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

      <AlertDialog open={redefinindo} onOpenChange={setRedefinindo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Redefinir a verificação em duas etapas de {email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Use quando a pessoa perdeu o celular ou trocou de aparelho. O app autenticador dela
              deixa de valer, ela sai de todas as sessões abertas e, no próximo acesso, cadastra o
              app de novo antes de entrar no painel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ocupado}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(evento) => {
                evento.preventDefault();
                rodar(async () => redefinirSegundoFatorDoAdmin(userId), 'Verificação redefinida.');
              }}
              disabled={ocupado}
            >
              {ocupado ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Redefinir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

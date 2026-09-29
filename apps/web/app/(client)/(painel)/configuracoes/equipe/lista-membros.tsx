'use client';

/**
 * C16 — quem está na equipe, com papel, desde quando e último acesso.
 *
 * Mudar papel e tirar alguém pedem confirmação dizendo o que muda: tirar
 * acaba com o acesso na hora, e tornar alguém proprietário dá a essa pessoa o
 * poder de excluir lojas e a empresa.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import { ROTULO_PAPEL, type MembershipRole } from '@storefy/db';
import { O_QUE_O_PAPEL_PODE } from '@/lib/convites';
import { FUSO_PADRAO, formatarData } from '@/lib/fuso';
import { mudarPapel, removerDaEquipe } from './acoes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
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

export interface Membro {
  id: string;
  email: string;
  nome: string | null;
  papel: MembershipRole;
  desde: string | null;
  ultimoAcesso: string | null;
}

const PAPEIS: readonly MembershipRole[] = ['owner', 'admin', 'member'];

type Pendente =
  | { tipo: 'papel'; membro: Membro; novoPapel: MembershipRole }
  | { tipo: 'remover'; membro: Membro };

export function ListaDeMembros({
  membros,
  euId,
  podeGerir,
  fuso,
}: {
  membros: Membro[];
  euId: string;
  podeGerir: boolean;
  fuso: string | null;
}) {
  const router = useRouter();
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [rodando, iniciar] = useTransition();
  const fusoDasDatas = fuso ?? FUSO_PADRAO;

  function confirmar() {
    if (pendente === null) return;
    const alvo = pendente;
    iniciar(async () => {
      const resultado =
        alvo.tipo === 'papel'
          ? await mudarPapel(alvo.membro.id, alvo.novoPapel)
          : await removerDaEquipe(alvo.membro.id);
      setPendente(null);
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Pronto.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível concluir.');
      }
    });
  }

  const nomeDe = (membro: Membro) => membro.nome ?? membro.email;

  return (
    <>
      <ul className="divide-y">
        {membros.map((membro) => {
          const souEu = membro.id === euId;
          return (
            <li
              key={membro.id}
              className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium break-words">
                  {nomeDe(membro)}
                  {souEu ? (
                    <Badge variant="outline" className="ml-2 align-middle">
                      Você
                    </Badge>
                  ) : null}
                </p>
                {membro.nome == null ? null : (
                  <p className="text-muted-foreground text-sm break-all">{membro.email}</p>
                )}
                <p className="text-muted-foreground text-xs">
                  Na equipe desde {formatarData(membro.desde, fusoDasDatas)}
                  {' · '}
                  {membro.ultimoAcesso == null
                    ? 'ainda não entrou'
                    : `último acesso em ${formatarData(membro.ultimoAcesso, fusoDasDatas)}`}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {podeGerir && !souEu ? (
                  <>
                    <label className="sr-only" htmlFor={`papel-${membro.id}`}>
                      Papel de {nomeDe(membro)}
                    </label>
                    <Select
                      id={`papel-${membro.id}`}
                      value={membro.papel}
                      disabled={rodando}
                      className="h-9 w-40"
                      onChange={(evento) => {
                        const novo = PAPEIS.find((papel) => papel === evento.target.value);
                        if (novo !== undefined && novo !== membro.papel) {
                          setPendente({ tipo: 'papel', membro, novoPapel: novo });
                        }
                      }}
                    >
                      {PAPEIS.map((papel) => (
                        <option key={papel} value={papel}>
                          {ROTULO_PAPEL[papel]}
                        </option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={rodando}
                      onClick={() => {
                        setPendente({ tipo: 'remover', membro });
                      }}
                    >
                      <UserMinus aria-hidden />
                      Remover
                      <span className="sr-only"> {nomeDe(membro)}</span>
                    </Button>
                  </>
                ) : (
                  <Badge variant={membro.papel === 'owner' ? 'secondary' : 'outline'}>
                    {ROTULO_PAPEL[membro.papel]}
                  </Badge>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <AlertDialog
        open={pendente !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setPendente(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendente?.tipo === 'remover'
                ? `Remover ${pendente.membro.nome ?? pendente.membro.email} da equipe?`
                : pendente?.tipo === 'papel'
                  ? `Tornar ${pendente.membro.nome ?? pendente.membro.email} ${ROTULO_PAPEL[pendente.novoPapel].toLowerCase()}?`
                  : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendente?.tipo === 'remover'
                ? 'O acesso ao painel desta empresa acaba agora. A conta da pessoa continua existindo, e dá para convidar de novo depois.'
                : pendente?.tipo === 'papel'
                  ? `${O_QUE_O_PAPEL_PODE[pendente.novoPapel]}${pendente.novoPapel === 'owner' ? ' Um proprietário pode, inclusive, tirar você da equipe.' : ''}`
                  : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rodando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={rodando}
              className={
                pendente?.tipo === 'remover'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : undefined
              }
              onClick={(evento) => {
                evento.preventDefault();
                confirmar();
              }}
            >
              {rodando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {pendente?.tipo === 'remover' ? 'Remover' : 'Mudar papel'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

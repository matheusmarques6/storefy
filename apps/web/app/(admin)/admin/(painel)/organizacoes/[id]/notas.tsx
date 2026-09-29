'use client';

/**
 * As notas internas na ficha do cliente (A04).
 *
 * O AVISO DE QUE O CLIENTE NÃO LÊ fica na tela, e não só no código. Quem
 * escreve uma nota sobre um cliente precisa saber, no momento de escrever, se
 * aquilo pode ou não ser lido por ele — a diferença muda o que se escreve. Um
 * comentário no arquivo não chega a essa pessoa.
 *
 * Apagar pede confirmação porque destrói o histórico de um cliente e não tem
 * volta. Escrever, não: escrever é o ato barato aqui.
 */
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EyeOff, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { FUSO_PADRAO, formatarDataHora } from '@/lib/fuso';
import { MAXIMO_DA_NOTA, type Nota } from '@/lib/notas-internas';
import { adicionarNota, apagarNota, type EstadoDaNota } from './acoes';
import { valoresDigitados, type ValoresDigitados } from '@/lib/validacao';
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

export function Notas({ orgId, notas }: { orgId: string; notas: Nota[] }) {
  const router = useRouter();

  const [estado, enviar, enviando] = useActionState<
    EstadoDaNota & { valores?: ValoresDigitados },
    FormData
  >(async (anterior, dados) => {
    const resultado = await adicionarNota(anterior, dados);

    if (resultado.ok === true) {
      toast.success(resultado.mensagem ?? 'Nota salva.');
      router.refresh();
      // Salva, a caixa volta vazia para a próxima nota.
      return { ...resultado, valores: {} };
    }
    if (resultado.mensagem != null) toast.error(resultado.mensagem);
    // Recusada, a nota continua escrita: o React limpa o formulário no fim da
    // ação, e a limpeza volta para o `defaultValue` — que é o texto enviado.
    return { ...resultado, valores: valoresDigitados(dados, ['body']) };
  }, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notas internas</CardTitle>
        <CardDescription className="flex items-start gap-1.5">
          <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Só a equipe da Storefy vê isto. O cliente não tem acesso, nem o dono da organização.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <form action={enviar} className="space-y-2" noValidate>
          <input type="hidden" name="orgId" value={orgId} />
          <label htmlFor="body" className="sr-only">
            Nova nota
          </label>
          <textarea
            id="body"
            name="body"
            defaultValue={estado.valores?.body}
            rows={3}
            maxLength={MAXIMO_DA_NOTA}
            placeholder="O que aconteceu com este cliente?"
            className="border-input bg-background focus-visible:ring-ring w-full rounded-xl border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          />

          {estado.ok !== true && estado.mensagem != null ? (
            <p className="text-destructive text-sm" role="alert">
              {estado.mensagem}
            </p>
          ) : null}

          <Button type="submit" size="sm" disabled={enviando}>
            {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Salvar nota
          </Button>
        </form>

        {notas.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhuma nota ainda. A primeira costuma ser a mais útil: por que este cliente chegou até
            aqui.
          </p>
        ) : (
          <ul className="space-y-3">
            {notas.map((nota) => (
              <Linha key={nota.id} nota={nota} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Linha({ nota }: { nota: Nota }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [apagando, iniciar] = useTransition();

  function apagar() {
    iniciar(async () => {
      const resultado = await apagarNota(nota.id);
      setConfirmando(false);

      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Nota apagada.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível apagar.');
      }
    });
  }

  return (
    <li className="border-input rounded-lg border p-3">
      {/* `whitespace-pre-wrap`: quem escreveu em parágrafos escreveu por um
          motivo, e juntar tudo numa linha só perde o que foi separado. */}
      <p className="text-sm whitespace-pre-wrap">{nota.texto}</p>

      <div className="text-muted-foreground mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>
          {nota.autor}
          {nota.quando == null ? '' : ` · ${formatarDataHora(nota.quando, FUSO_PADRAO)}`}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={apagando}
          onClick={() => {
            setConfirmando(true);
          }}
        >
          {apagando ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="size-3.5" aria-hidden />
          )}
          Apagar
        </Button>
      </div>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar esta nota?</AlertDialogTitle>
            <AlertDialogDescription>
              O histórico deste cliente perde o que está escrito aqui, e não dá para desfazer. Quem
              apagou e o que a nota dizia ficam registrados na auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={apagando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(evento) => {
                evento.preventDefault();
                apagar();
              }}
              disabled={apagando}
            >
              {apagando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

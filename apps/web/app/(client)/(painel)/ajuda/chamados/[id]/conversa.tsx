'use client';

/**
 * C17 — responder e fechar um chamado. Escrever num chamado fechado o reabre
 * (é o que o banco faz), e a tela diz isso.
 */
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { TAMANHO_MAXIMO_DA_MENSAGEM } from '@/lib/chamados';
import { fecharChamado, responderChamado, type EstadoDoChamado } from '../../acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Textarea } from '@/components/ui/textarea';
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

export function ResponderChamado({ ticketId, fechado }: { ticketId: string; fechado: boolean }) {
  const router = useRouter();
  const [estado, acao] = useActionState<EstadoDoChamado, FormData>(async (anterior, dados) => {
    const resultado = await responderChamado(ticketId, anterior, dados);
    if (resultado.ok === true) router.refresh();
    return resultado;
  }, {});

  return (
    <form action={acao} className="space-y-3" noValidate>
      {estado.mensagem == null ? null : (
        <Alert variant={estado.ok === true ? 'info' : 'destructive'}>
          {estado.ok === true ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
          <AlertDescription>{estado.mensagem}</AlertDescription>
        </Alert>
      )}
      <Campo
        id="mensagem"
        rotulo={fechado ? 'Escrever de novo (reabre o chamado)' : 'Sua resposta'}
        erro={estado.erros?.mensagem}
      >
        <Textarea
          {...propsDoCampo('mensagem', estado.erros?.mensagem)}
          defaultValue={estado.valores?.mensagem}
          rows={4}
          maxLength={TAMANHO_MAXIMO_DA_MENSAGEM}
        />
      </Campo>
      <BotaoEnviar carregando="Enviando...">Enviar</BotaoEnviar>
    </form>
  );
}

export function FecharChamado({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [rodando, iniciar] = useTransition();

  function fechar() {
    iniciar(async () => {
      const resultado = await fecharChamado(ticketId);
      setConfirmando(false);
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Chamado fechado.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível fechar.');
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={rodando}
        onClick={() => {
          setConfirmando(true);
        }}
      >
        Fechar chamado
      </Button>
      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar este chamado?</AlertDialogTitle>
            <AlertDialogDescription>
              Feche quando o problema estiver resolvido. Se precisar, é só escrever de novo nele: o
              chamado reabre.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rodando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={rodando}
              onClick={(evento) => {
                evento.preventDefault();
                fechar();
              }}
            >
              {rodando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Fechar chamado
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

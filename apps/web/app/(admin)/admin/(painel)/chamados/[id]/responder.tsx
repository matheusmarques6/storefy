'use client';

/**
 * A14 — responder como equipe, e fechar ou reabrir. Fechar não pede
 * confirmação: é desfeito com um clique ("Reabrir"), e a própria resposta do
 * cliente reabre.
 */
import { useActionState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { TAMANHO_MAXIMO_DA_MENSAGEM } from '@/lib/chamados';
import { mudarSituacaoDoChamado, responderComoEquipe, type EstadoDaResposta } from '../acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Textarea } from '@/components/ui/textarea';

export function ResponderComoEquipe({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [estado, acao] = useActionState<EstadoDaResposta, FormData>(async (anterior, dados) => {
    const resultado = await responderComoEquipe(ticketId, anterior, dados);
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
        rotulo="Resposta da equipe"
        erro={estado.erros?.mensagem}
        dica="O cliente vê esta mensagem como da Equipe Storefy, sem o seu nome."
      >
        <Textarea
          {...propsDoCampo('mensagem', estado.erros?.mensagem, true)}
          defaultValue={estado.valores?.mensagem}
          rows={5}
          maxLength={TAMANHO_MAXIMO_DA_MENSAGEM}
        />
      </Campo>
      <BotaoEnviar carregando="Enviando...">Responder</BotaoEnviar>
    </form>
  );
}

export function MudarSituacao({ ticketId, fechado }: { ticketId: string; fechado: boolean }) {
  const router = useRouter();
  const [rodando, iniciar] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={rodando}
      onClick={() => {
        iniciar(async () => {
          const resultado = await mudarSituacaoDoChamado(ticketId, fechado ? 'aberto' : 'fechado');
          if (resultado.ok === true) {
            toast.success(resultado.mensagem ?? 'Pronto.');
            router.refresh();
          } else {
            toast.error(resultado.mensagem ?? 'Não foi possível mudar.');
          }
        });
      }}
    >
      {rodando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {fechado ? 'Reabrir' : 'Fechar chamado'}
    </Button>
  );
}

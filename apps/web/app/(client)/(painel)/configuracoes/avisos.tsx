'use client';

/**
 * C16 — os avisos por e-mail de quem está usando, nesta empresa.
 *
 * As caixas são livres, com o padrão devolvido pela ação: numa caixa de
 * marcar controlada, a limpeza do formulário no fim da ação a devolveria ao
 * valor do primeiro desenho (`formularios-controlados.test.ts`).
 */
import { useActionState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { salvarAvisos, type EstadoDosAvisos } from './acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';

export function FormularioDeAvisos({
  revisaoDoApp,
  respostaDoSuporte,
  recebeRevisao,
}: {
  revisaoDoApp: boolean;
  respostaDoSuporte: boolean;
  /** O aviso da revisão só vai para proprietários e administradores. */
  recebeRevisao: boolean;
}) {
  const [estado, acao] = useActionState<EstadoDosAvisos, FormData>(salvarAvisos, {});

  return (
    <form action={acao} className="space-y-4" noValidate>
      {estado.mensagem == null ? null : (
        <Alert variant={estado.ok === true ? 'info' : 'destructive'}>
          {estado.ok === true ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
          <AlertDescription>{estado.mensagem}</AlertDescription>
        </Alert>
      )}

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="revisaoDoApp"
          defaultChecked={estado.revisaoDoApp ?? revisaoDoApp}
          disabled={!recebeRevisao}
          className="mt-1 size-4"
        />
        <span className="text-sm">
          <span className="font-medium">Resultado da revisão do app</span>
          <span className="text-muted-foreground block">
            {recebeRevisao
              ? 'Quando a Apple ou o Google aprovar ou recusar o app de uma loja.'
              : 'Só proprietários e administradores recebem este aviso.'}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="respostaDoSuporte"
          defaultChecked={estado.respostaDoSuporte ?? respostaDoSuporte}
          className="mt-1 size-4"
        />
        <span className="text-sm">
          <span className="font-medium">Resposta do suporte</span>
          <span className="text-muted-foreground block">
            Quando a equipe da Storefy responder um chamado que você abriu.
          </span>
        </span>
      </label>

      <BotaoEnviar carregando="Salvando...">Salvar avisos</BotaoEnviar>
    </form>
  );
}

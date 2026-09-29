'use client';

import { useActionState, useState, useTransition } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { aceitarConviteDaLista, criarMinhaEmpresa, type EstadoSemEmpresa } from './acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';

export function AceitarDaLista({ id, empresa }: { id: string; empresa: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [rodando, iniciar] = useTransition();

  return (
    <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
      <Button
        type="button"
        size="sm"
        disabled={rodando}
        onClick={() => {
          iniciar(async () => {
            const resultado = await aceitarConviteDaLista(id);
            if (resultado.ok === true) {
              window.location.assign(resultado.destino ?? '/');
              return;
            }
            setErro(resultado.mensagem ?? 'Não foi possível aceitar.');
          });
        }}
      >
        {rodando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Aceitar
        <span className="sr-only"> o convite de {empresa}</span>
      </Button>
      {erro === null ? null : (
        <p role="alert" className="text-destructive text-xs">
          {erro}
        </p>
      )}
    </div>
  );
}

export function CriarEmpresa() {
  const [estado, acao] = useActionState<EstadoSemEmpresa, FormData>(async (anterior, dados) => {
    const resultado = await criarMinhaEmpresa(anterior, dados);
    // A empresa nova é a ativa (cookie): o painel nasce de novo nela.
    if (resultado.ok === true) window.location.assign(resultado.destino ?? '/');
    return resultado;
  }, {});

  return (
    <form action={acao} className="space-y-4" noValidate>
      {estado.ok === true || estado.mensagem == null ? null : (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{estado.mensagem}</AlertDescription>
        </Alert>
      )}
      <Campo id="nome" rotulo="Nome da empresa" erro={estado.erros?.nome}>
        <Input
          {...propsDoCampo('nome', estado.erros?.nome)}
          defaultValue={estado.valores?.nome}
          autoComplete="organization"
          placeholder="Minha Loja"
          required
        />
      </Campo>
      <BotaoEnviar className="w-full" carregando="Criando...">
        Criar empresa
      </BotaoEnviar>
    </form>
  );
}

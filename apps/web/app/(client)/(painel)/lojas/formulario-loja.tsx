'use client';

import { useActionState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { EstadoLoja } from './acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';

export function FormularioLoja({
  acao,
  nomeInicial = '',
  urlInicial = '',
  rotuloEnvio,
  carregando,
}: {
  acao: (anterior: EstadoLoja, dados: FormData) => Promise<EstadoLoja>;
  nomeInicial?: string;
  urlInicial?: string;
  rotuloEnvio: string;
  carregando: string;
}) {
  const [estado, despachar] = useActionState<EstadoLoja, FormData>(acao, {});

  return (
    <form action={despachar} className="space-y-4" noValidate>
      {estado.mensagem == null ? null : (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{estado.mensagem}</AlertDescription>
        </Alert>
      )}

      <Campo
        id="nome"
        rotulo="Nome da loja"
        erro={estado.erros?.nome}
        dica="É o nome que aparece no painel e, depois, no app."
      >
        <Input
          {...propsDoCampo('nome', estado.erros?.nome, true)}
          defaultValue={nomeInicial}
          placeholder="Minha Loja"
          required
        />
      </Campo>

      <Campo
        id="url"
        rotulo="Endereço da loja"
        erro={estado.erros?.url}
        dica="O site que o app vai abrir. Exemplo: minhaloja.com.br"
      >
        <Input
          {...propsDoCampo('url', estado.erros?.url, true)}
          defaultValue={urlInicial}
          placeholder="minhaloja.com.br"
          inputMode="url"
          required
        />
      </Campo>

      <BotaoEnviar carregando={carregando}>{rotuloEnvio}</BotaoEnviar>
    </form>
  );
}

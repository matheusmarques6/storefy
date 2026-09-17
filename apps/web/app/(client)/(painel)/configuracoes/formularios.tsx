'use client';

import { useActionState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  salvarConta,
  salvarOrganizacao,
  trocarEmail,
  trocarSenha,
  type EstadoConfig,
} from './acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';
import { MIN_SENHA } from '@/lib/validacao';

function Avisos({ estado }: { estado: EstadoConfig }) {
  if (estado.mensagem == null) return null;
  return (
    <Alert variant={estado.sucesso === true ? 'info' : 'destructive'}>
      {estado.sucesso === true ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
      <AlertDescription>{estado.mensagem}</AlertDescription>
    </Alert>
  );
}

export function FormularioOrganizacao({
  nomeInicial,
  somenteLeitura,
}: {
  nomeInicial: string;
  somenteLeitura: boolean;
}) {
  const [estado, acao] = useActionState<EstadoConfig, FormData>(salvarOrganizacao, {});

  return (
    <form action={acao} className="space-y-4" noValidate>
      <Avisos estado={estado} />
      <Campo id="nome" rotulo="Nome da empresa" erro={estado.erros?.nome}>
        <Input
          {...propsDoCampo('nome', estado.erros?.nome)}
          defaultValue={nomeInicial}
          disabled={somenteLeitura}
          required
        />
      </Campo>
      {somenteLeitura ? (
        <p className="text-muted-foreground text-xs">
          Somente proprietários e administradores podem alterar o nome da empresa.
        </p>
      ) : (
        <BotaoEnviar carregando="Salvando...">Salvar</BotaoEnviar>
      )}
    </form>
  );
}

export function FormularioNome({ nomeInicial }: { nomeInicial: string }) {
  const [estado, acao] = useActionState<EstadoConfig, FormData>(salvarConta, {});

  return (
    <form action={acao} className="space-y-4" noValidate>
      <Avisos estado={estado} />
      <Campo id="nome" rotulo="Seu nome" erro={estado.erros?.nome}>
        <Input
          {...propsDoCampo('nome', estado.erros?.nome)}
          defaultValue={nomeInicial}
          autoComplete="name"
          placeholder="Como podemos te chamar"
        />
      </Campo>
      <BotaoEnviar carregando="Salvando...">Salvar</BotaoEnviar>
    </form>
  );
}

export function FormularioEmail({ emailAtual }: { emailAtual: string }) {
  const [estado, acao] = useActionState<EstadoConfig, FormData>(trocarEmail, {});

  return (
    <form action={acao} className="space-y-4" noValidate>
      <Avisos estado={estado} />
      <Campo
        id="email"
        rotulo="E-mail"
        erro={estado.erros?.email}
        dica="Você precisa confirmar o novo endereço antes de a troca valer."
      >
        <Input
          {...propsDoCampo('email', estado.erros?.email, true)}
          type="email"
          defaultValue={emailAtual}
          autoComplete="email"
          required
        />
      </Campo>
      <BotaoEnviar carregando="Enviando...">Trocar e-mail</BotaoEnviar>
    </form>
  );
}

export function FormularioSenha() {
  const [estado, acao] = useActionState<EstadoConfig, FormData>(trocarSenha, {});

  return (
    <form action={acao} className="space-y-4" noValidate>
      <Avisos estado={estado} />
      <Campo id="senhaAtual" rotulo="Senha atual" erro={estado.erros?.senhaAtual}>
        <Input
          {...propsDoCampo('senhaAtual', estado.erros?.senhaAtual)}
          type="password"
          autoComplete="current-password"
          required
        />
      </Campo>
      <Campo
        id="senha"
        rotulo="Nova senha"
        erro={estado.erros?.senha}
        dica={`Pelo menos ${String(MIN_SENHA)} caracteres.`}
      >
        <Input
          {...propsDoCampo('senha', estado.erros?.senha, true)}
          type="password"
          autoComplete="new-password"
          minLength={MIN_SENHA}
          required
        />
      </Campo>
      <Campo id="confirmacao" rotulo="Repita a nova senha" erro={estado.erros?.confirmacao}>
        <Input
          {...propsDoCampo('confirmacao', estado.erros?.confirmacao)}
          type="password"
          autoComplete="new-password"
          required
        />
      </Campo>
      <BotaoEnviar carregando="Salvando...">Trocar senha</BotaoEnviar>
    </form>
  );
}

'use client';

/**
 * Os três jeitos de responder a um convite: aceitar, criar a conta pelo link
 * e trocar de conta. Ver `page.tsx`.
 */
import { useActionState, useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import {
  aceitarConvite,
  cadastrarPeloConvite,
  sairParaTrocarDeConta,
  type EstadoDoConvite,
} from './acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';
import { MIN_SENHA } from '@/lib/validacao';

function Aviso({ mensagem }: { mensagem: string | undefined }) {
  if (mensagem == null) return null;
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden />
      <AlertDescription>{mensagem}</AlertDescription>
    </Alert>
  );
}

export function AceitarConvite({ token }: { token: string }) {
  const [estado, setEstado] = useState<EstadoDoConvite>({});
  const [rodando, iniciar] = useTransition();

  return (
    <div className="space-y-3">
      <Aviso mensagem={estado.ok === true ? undefined : estado.mensagem} />
      <Button
        type="button"
        className="w-full"
        disabled={rodando}
        onClick={() => {
          iniciar(async () => {
            const resultado = await aceitarConvite(token);
            if (resultado.ok === true) {
              // A empresa ativa mudou (cookie): o painel nasce de novo nela.
              window.location.assign(resultado.destino ?? '/');
              return;
            }
            setEstado(resultado);
          });
        }}
      >
        {rodando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Aceitar convite
      </Button>
    </div>
  );
}

export function CadastroPeloConvite({
  token,
  email,
  pedeEmpresa,
}: {
  token: string;
  email: string;
  /** O lojista piloto cria a própria empresa junto com a conta. */
  pedeEmpresa: boolean;
}) {
  const [estado, acao] = useActionState<EstadoDoConvite, FormData>(
    cadastrarPeloConvite.bind(null, token),
    {},
  );

  return (
    <form action={acao} className="space-y-4" noValidate>
      <Aviso mensagem={estado.mensagem} />

      <Campo id="email" rotulo="E-mail" dica="O convite é para este e-mail.">
        <Input id="email" type="email" value={email} readOnly aria-describedby="email-dica" />
      </Campo>

      <Campo id="nome" rotulo="Seu nome" erro={estado.erros?.nome}>
        <Input
          {...propsDoCampo('nome', estado.erros?.nome)}
          defaultValue={estado.valores?.nome}
          autoComplete="name"
          placeholder="Como a equipe vai ver você"
          required
        />
      </Campo>

      {pedeEmpresa ? (
        <Campo
          id="nomeEmpresa"
          rotulo="Nome da sua empresa"
          erro={estado.erros?.nomeEmpresa}
          dica="É como sua conta aparece no painel. Dá para mudar depois."
        >
          <Input
            {...propsDoCampo('nomeEmpresa', estado.erros?.nomeEmpresa, true)}
            defaultValue={estado.valores?.nomeEmpresa}
            autoComplete="organization"
            placeholder="Minha Loja"
            required
          />
        </Campo>
      ) : null}

      <Campo
        id="senha"
        rotulo="Crie uma senha"
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

      <BotaoEnviar className="w-full" carregando="Criando conta...">
        Criar conta e aceitar
      </BotaoEnviar>

      <p className="text-muted-foreground text-center text-sm">
        Já tem conta com este e-mail?{' '}
        <Link
          href={`/entrar?proximo=${encodeURIComponent(`/convite/${token}`)}`}
          className="text-foreground font-medium underline underline-offset-4"
        >
          Entrar
        </Link>
      </p>
    </form>
  );
}

export function TrocarDeConta({
  token,
  emailDoConvite,
  emailDaSessao,
}: {
  token: string;
  emailDoConvite: string;
  emailDaSessao: string;
}) {
  const [rodando, iniciar] = useTransition();

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Este convite é para <span className="font-medium">{emailDoConvite}</span>, e você entrou
        como <span className="font-medium">{emailDaSessao}</span>. Para aceitar, saia desta conta e
        entre (ou crie a conta) com o e-mail do convite.
      </p>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={rodando}
        onClick={() => {
          iniciar(async () => {
            const resultado = await sairParaTrocarDeConta(token);
            window.location.assign(resultado.destino ?? '/entrar');
          });
        }}
      >
        {rodando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Sair e usar o e-mail do convite
      </Button>
      <Button asChild variant="ghost" className="w-full">
        <Link href="/">Continuar com esta conta</Link>
      </Button>
    </div>
  );
}

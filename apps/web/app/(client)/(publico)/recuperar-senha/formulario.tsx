'use client';

import { useActionState } from 'react';
import { AlertCircle, MailCheck } from 'lucide-react';
import { pedirRecuperacao, type EstadoFormulario } from '../acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Campo, propsDoCampo } from '@/components/campo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function FormularioRecuperar() {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(pedirRecuperacao, {});

  if (estado.sucesso === true) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Verifique seu e-mail</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="info">
            <MailCheck aria-hidden />
            <AlertDescription>{estado.mensagem}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recuperar senha</CardTitle>
        <CardDescription>Enviamos um link para você criar uma nova senha.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={acao} className="space-y-4" noValidate>
          {estado.mensagem == null ? null : (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <AlertDescription>{estado.mensagem}</AlertDescription>
            </Alert>
          )}
          <Campo id="email" rotulo="E-mail" erro={estado.erros?.email}>
            <Input
              {...propsDoCampo('email', estado.erros?.email)}
              type="email"
              autoComplete="email"
              placeholder="voce@suaempresa.com.br"
              required
            />
          </Campo>
          <BotaoEnviar className="w-full" carregando="Enviando...">
            Enviar link
          </BotaoEnviar>
        </form>
      </CardContent>
    </Card>
  );
}

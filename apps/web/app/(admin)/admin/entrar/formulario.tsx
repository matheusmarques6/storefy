'use client';

import { useActionState } from 'react';
import { AlertCircle } from 'lucide-react';
import { entrarAdmin, type EstadoAdmin } from '../acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Campo, propsDoCampo } from '@/components/campo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function FormularioLoginAdmin() {
  const [estado, acao] = useActionState<EstadoAdmin, FormData>(entrarAdmin, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Painel Storefy</CardTitle>
        <CardDescription>Acesso restrito à equipe.</CardDescription>
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
              required
            />
          </Campo>
          <Campo id="senha" rotulo="Senha" erro={estado.erros?.senha}>
            <Input
              {...propsDoCampo('senha', estado.erros?.senha)}
              type="password"
              autoComplete="current-password"
              required
            />
          </Campo>
          <BotaoEnviar className="w-full" carregando="Entrando...">
            Entrar
          </BotaoEnviar>
        </form>
      </CardContent>
    </Card>
  );
}

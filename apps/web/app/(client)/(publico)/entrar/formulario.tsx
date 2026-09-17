'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { entrar, type EstadoFormulario } from '../acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Campo, propsDoCampo } from '@/components/campo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function FormularioLogin({
  erroExterno,
  proximo,
}: {
  erroExterno?: string | undefined;
  proximo: string;
}) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(entrar, {});
  const mensagem = estado.mensagem ?? erroExterno;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>Acesse o painel da sua loja.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={acao} className="space-y-4" noValidate>
          <input type="hidden" name="proximo" value={proximo} />

          {mensagem == null ? null : (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <AlertDescription>{mensagem}</AlertDescription>
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

          <Campo id="senha" rotulo="Senha" erro={estado.erros?.senha}>
            <Input
              {...propsDoCampo('senha', estado.erros?.senha)}
              type="password"
              autoComplete="current-password"
              required
            />
          </Campo>

          <div className="flex justify-end">
            <Link
              href="/recuperar-senha"
              className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
            >
              Esqueci minha senha
            </Link>
          </div>

          <BotaoEnviar className="w-full" carregando="Entrando...">
            Entrar
          </BotaoEnviar>
        </form>
      </CardContent>
    </Card>
  );
}

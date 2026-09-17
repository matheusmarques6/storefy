'use client';

import { useActionState } from 'react';
import { AlertCircle } from 'lucide-react';
import { cadastrar, type EstadoFormulario } from '../acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Campo, propsDoCampo } from '@/components/campo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MIN_SENHA } from '@/lib/validacao';

export function FormularioCadastro() {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(cadastrar, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Criar conta</CardTitle>
        <CardDescription>Comece agora. Leva menos de um minuto.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={acao} className="space-y-4" noValidate>
          {estado.mensagem == null ? null : (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <AlertDescription>{estado.mensagem}</AlertDescription>
            </Alert>
          )}

          <Campo
            id="nomeEmpresa"
            rotulo="Nome da sua empresa"
            erro={estado.erros?.nomeEmpresa}
            dica="É como sua conta aparece no painel. Dá para mudar depois."
          >
            <Input
              {...propsDoCampo('nomeEmpresa', estado.erros?.nomeEmpresa, true)}
              autoComplete="organization"
              placeholder="Minha Loja"
              required
            />
          </Campo>

          <Campo id="email" rotulo="E-mail" erro={estado.erros?.email}>
            <Input
              {...propsDoCampo('email', estado.erros?.email)}
              type="email"
              autoComplete="email"
              placeholder="voce@suaempresa.com.br"
              required
            />
          </Campo>

          <Campo
            id="senha"
            rotulo="Senha"
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
            Criar conta
          </BotaoEnviar>
        </form>
      </CardContent>
    </Card>
  );
}

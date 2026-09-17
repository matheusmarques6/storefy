'use client';

import { useActionState } from 'react';
import { AlertCircle } from 'lucide-react';
import { redefinirSenha, type EstadoFormulario } from '../acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Campo, propsDoCampo } from '@/components/campo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MIN_SENHA } from '@/lib/validacao';

export function FormularioRedefinir() {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(redefinirSenha, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Criar nova senha</CardTitle>
        <CardDescription>Escolha uma senha que você ainda não usou aqui.</CardDescription>
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
          <BotaoEnviar className="w-full" carregando="Salvando...">
            Salvar nova senha
          </BotaoEnviar>
        </form>
      </CardContent>
    </Card>
  );
}

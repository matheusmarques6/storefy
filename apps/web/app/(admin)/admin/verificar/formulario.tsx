'use client';

/** A01c — o código do app autenticador. */
import { useActionState, useState } from 'react';
import { AlertCircle, Smartphone } from 'lucide-react';
import { sairDoAdmin } from '../acoes';
import { verificarCodigo, type EstadoDaVerificacao } from './acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function FormularioVerificar({ email }: { email: string }) {
  const [estado, acao] = useActionState<EstadoDaVerificacao, FormData>(verificarCodigo, {});
  // Controlado: o código recusado continua no campo, selecionado — digitar o
  // novo já troca o velho, e um dígito trocado ainda dá para ver.
  const [codigo, setCodigo] = useState('');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verificação em duas etapas</CardTitle>
        <CardDescription>
          Abra o app autenticador do seu celular e digite o código de 6 números de “Storefy Admin”
          {email === '' ? '' : ` (${email})`}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form action={acao} className="space-y-4" noValidate>
          {estado.mensagem == null ? null : (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <AlertDescription>{estado.mensagem}</AlertDescription>
            </Alert>
          )}
          <Campo id="codigo" rotulo="Código do app" erro={estado.erros?.codigo}>
            <Input
              {...propsDoCampo('codigo', estado.erros?.codigo)}
              key={estado.tentativa ?? 0}
              value={codigo}
              onChange={(evento) => {
                setCodigo(evento.target.value);
              }}
              onFocus={(evento) => {
                evento.currentTarget.select();
              }}
              // O único campo da tela: focar sozinho poupa um clique a cada entrada.
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="123456"
              className="text-center font-mono text-lg tracking-[0.3em]"
            />
          </Campo>
          <BotaoEnviar className="w-full" carregando="Conferindo...">
            Confirmar
          </BotaoEnviar>
        </form>

        <div className="text-muted-foreground flex items-start gap-2 text-sm">
          <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Perdeu o celular ou trocou de aparelho? Peça a um superadmin da Storefy para redefinir a
            sua verificação na tela Equipe. Depois disso, você cadastra o app de novo no próximo
            acesso.
          </p>
        </div>

        <form action={sairDoAdmin}>
          <Button type="submit" variant="ghost" className="w-full">
            Sair e entrar com outra conta
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

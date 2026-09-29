'use client';

/**
 * A04 — estender o teste de um cliente. A data é o último dia liberado, no
 * horário de Brasília, até 90 dias à frente (o banco confere de novo).
 */
import { useActionState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { estenderTeste, type EstadoDoTeste } from './acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function EstenderTeste({
  orgId,
  hoje,
  maximo,
}: {
  orgId: string;
  /** "AAAA-MM-DD", de Brasília: o menor dia que dá para escolher. */
  hoje: string;
  maximo: string;
}) {
  const [estado, acao] = useActionState<EstadoDoTeste, FormData>(estenderTeste, {});

  return (
    <form action={acao} className="space-y-3" noValidate>
      {estado.mensagem == null ? null : (
        <Alert variant={estado.ok === true ? 'info' : 'destructive'}>
          {estado.ok === true ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
          <AlertDescription>{estado.mensagem}</AlertDescription>
        </Alert>
      )}
      <input type="hidden" name="orgId" value={orgId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-2">
          <Label htmlFor="ate">Teste até</Label>
          <Input
            id="ate"
            name="ate"
            type="date"
            min={hoje}
            max={maximo}
            defaultValue={estado.valores?.ate ?? ''}
            className="w-44"
          />
        </div>
        <BotaoEnviar variant="outline" carregando="Estendendo...">
          Estender teste
        </BotaoEnviar>
      </div>
      <p className="text-muted-foreground text-xs">
        Libera tudo até o fim do dia escolhido, no horário de Brasília. Fica na trilha do cliente,
        com o seu nome.
      </p>
    </form>
  );
}

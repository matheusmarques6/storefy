/**
 * O estado "push ainda não configurado".
 *
 * Aparece quando o app da loja ainda não tem um OneSignal ligado. A regra 1 do
 * CLAUDE.md pede exatamente isto: em vez de uma tela que finge funcionar ou de
 * números inventados, um estado explícito dizendo o que falta e de quem
 * depende. O push depende de chave da Apple e conta do Google, que são ações
 * humanas — e o lojista precisa saber disso sem abrir um chamado.
 */
import Link from 'next/link';
import { BellOff } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function PushNaoConfigurado() {
  return (
    <Alert>
      <BellOff className="size-4" aria-hidden />
      <AlertTitle>As notificações ainda não estão ligadas</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Para enviar notificações, o app da sua loja precisa das credenciais de push da Apple e do
          Google. Elas são criadas nas contas de desenvolvedor da sua empresa — só você pode gerar,
          e a gente configura o resto.
        </p>
        <p>
          Enquanto isso, você já pode escrever campanhas e deixar as automações prontas: elas ficam
          guardadas e começam a sair assim que a configuração terminar.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/configuracoes">Ver o que falta</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

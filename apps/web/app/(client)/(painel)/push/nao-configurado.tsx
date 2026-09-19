'use client';

/**
 * O estado "push ainda não configurado", com o que falta e de quem depende.
 *
 * A regra 1 do CLAUDE.md pede exatamente isto: em vez de uma tela que finge
 * funcionar, um estado explícito dizendo o que falta. E a regra 3 pede que,
 * quando algo depende de uma ação humana, o ponto fique bloqueado com um
 * estado claro — aqui, a lista separa o que é nosso do que é do lojista, para
 * ele não ficar esperando por algo que só ele pode fazer, nem o contrário.
 */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BellOff, Circle, Loader2, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import type { Pendencia } from '@/lib/onesignal-org';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ligarNotificacoes } from './acoes';

interface Props {
  pendencias: readonly Pendencia[];
  podeEscrever: boolean;
}

export function PushNaoConfigurado({ pendencias, podeEscrever }: Props) {
  const router = useRouter();
  const [ligando, iniciar] = useTransition();

  const doLojista = pendencias.filter((pendencia) => pendencia.de === 'lojista');
  const nossas = pendencias.filter((pendencia) => pendencia.de === 'storefy');
  const prontoParaLigar = pendencias.length === 0;

  function ligar() {
    iniciar(async () => {
      const resultado = await ligarNotificacoes();
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Notificações ligadas.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível ligar as notificações.');
      }
    });
  }

  return (
    <Alert>
      <BellOff className="size-4" aria-hidden />
      <AlertTitle>
        {prontoParaLigar
          ? 'Tudo pronto para ligar as notificações'
          : 'As notificações ainda não estão ligadas'}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        {prontoParaLigar ? (
          <p>
            Suas contas Apple e Google já estão conectadas. Ligue as notificações para começar a
            enviar campanhas.
          </p>
        ) : (
          <>
            {doLojista.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-foreground font-medium">O que depende de você</p>
                <ul className="space-y-1.5">
                  {doLojista.map((pendencia) => (
                    <li key={pendencia.texto} className="flex items-start gap-2">
                      <UserCog className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span>{pendencia.texto}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {nossas.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-foreground font-medium">O que depende da Storefy</p>
                <ul className="space-y-1.5">
                  {nossas.map((pendencia) => (
                    <li key={pendencia.texto} className="flex items-start gap-2">
                      <Circle className="mt-1 size-2 shrink-0 fill-current" aria-hidden />
                      <span>{pendencia.texto}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}

        {/*
          "Enquanto isso" só faz sentido enquanto falta alguma coisa. Com tudo
          pronto, a frase manda esperar por algo que já aconteceu.
        */}
        {prontoParaLigar ? null : (
          <p className="text-muted-foreground">
            Enquanto isso, você já pode escrever campanhas e deixar as automações prontas: elas
            ficam guardadas e começam a sair assim que a configuração terminar.
          </p>
        )}

        {prontoParaLigar && podeEscrever ? (
          <Button size="sm" disabled={ligando} onClick={ligar}>
            {ligando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Ligar notificações
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

'use client';

/**
 * A chave do webhook (C09), dentro do card "Klaviyo, Omnisend e outras
 * ferramentas".
 *
 * A chave aparece UMA vez, logo depois de gerada: o banco guarda só o hash, e
 * não há como mostrá-la de novo. Perdeu, gera outra — e a anterior para na
 * hora, porque é exatamente isso que se quer quando uma chave vaza.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatarDataHora } from '@/lib/fuso';
import type { ChaveDoWebhook } from '@/lib/push-servidor';
import { LinhaCopiavel } from '@/components/linha-copiavel';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { desativarChaveDoWebhook, gerarChaveDoWebhook } from '../acoes';

/** O corpo de exemplo, com a variável de e-mail do Klaviyo. */
const EXEMPLO = `{
  "email": "{{ person.email }}",
  "title": "Separamos algo para você",
  "body": "Toque para ver as novidades da semana.",
  "deepLink": "/collections/all"
}`;

interface Props {
  /** O endereço que a ferramenta chama. */
  endereco: string;
  chave: ChaveDoWebhook | null;
  ligada: boolean;
  fuso: string;
  podeEscrever: boolean;
}

export function SecaoDoWebhook({ endereco, chave, ligada, fuso, podeEscrever }: Props) {
  const router = useRouter();
  const [nova, setNova] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<'trocar' | 'desativar' | null>(null);
  const [enviando, iniciar] = useTransition();

  function gerar() {
    iniciar(async () => {
      const resultado = await gerarChaveDoWebhook();
      setConfirmando(null);
      if (!resultado.ok) {
        toast.error(resultado.mensagem);
        return;
      }
      setNova(resultado.chave);
      toast.success('Chave gerada. Copie agora: ela não aparece de novo.');
      router.refresh();
    });
  }

  function desativar() {
    iniciar(async () => {
      const resultado = await desativarChaveDoWebhook();
      setConfirmando(null);
      if (resultado.ok !== true) {
        toast.error(resultado.mensagem ?? 'Não foi possível desativar a chave.');
        return;
      }
      setNova(null);
      toast.success(resultado.mensagem ?? 'Chave desativada.');
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="webhook-titulo" className="space-y-4 border-t pt-4">
      <div className="space-y-1">
        <h3 id="webhook-titulo" className="text-sm font-medium">
          Conectar a sua ferramenta
        </h3>
        <p className="text-muted-foreground text-sm">
          No fluxo da sua ferramenta, adicione a ação de webhook com o endereço e a chave abaixo.
          Recebe o push quem tem o app instalado e já entrou na conta pelo app; quem não tem
          continua recebendo só o e-mail.
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Endereço</p>
        <LinhaCopiavel valor={endereco} monoespacado />
      </div>

      {nova === null ? null : (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40"
        >
          <p className="text-sm font-medium">Sua chave nova</p>
          <LinhaCopiavel valor={nova} monoespacado />
          <p className="text-sm">
            Copie e guarde agora: por segurança, ela não aparece de novo. Se perder, é só gerar
            outra.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setNova(null);
            }}
          >
            Já guardei
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Chave</p>
        {chave === null ? (
          <p className="text-muted-foreground text-sm">
            Nenhuma chave ainda. Gere uma para a sua ferramenta poder chamar este endereço.
          </p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted-foreground">Termina em</dt>
            <dd className="font-mono">••••{chave.dica}</dd>
            <dt className="text-muted-foreground">Criada em</dt>
            <dd>{formatarDataHora(chave.criadaEm, fuso)}</dd>
            <dt className="text-muted-foreground">Último aviso recebido</dt>
            <dd>
              {chave.ultimoAviso === null
                ? 'Nenhum ainda'
                : formatarDataHora(chave.ultimoAviso, fuso)}
            </dd>
            <dt className="text-muted-foreground">Avisos recebidos</dt>
            <dd>{chave.avisos.toLocaleString('pt-BR')}</dd>
          </dl>
        )}
      </div>

      {chave !== null && chave.avisos > 0 && !ligada ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          A sua ferramenta está chamando, mas a automação está desligada: ninguém recebe o push até
          você ligar a chave no alto deste card.
        </p>
      ) : null}

      {podeEscrever ? (
        <div className="flex flex-wrap gap-2">
          {chave === null ? (
            <Button type="button" size="sm" disabled={enviando} onClick={gerar}>
              {enviando ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <KeyRound className="size-4" aria-hidden />
              )}
              Gerar chave
            </Button>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={enviando}
                onClick={() => {
                  setConfirmando('trocar');
                }}
              >
                Gerar chave nova
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={enviando}
                onClick={() => {
                  setConfirmando('desativar');
                }}
              >
                Desativar chave
              </Button>
            </>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          Só quem é proprietário ou administrador gera e troca a chave.
        </p>
      )}

      <details className="rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Detalhes para quem vai configurar</summary>
        <div className="mt-3 space-y-3">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Método <code>POST</code>, com o cabeçalho <code>Authorization: Bearer</code> seguido
              da chave. Se a ferramenta não deixar pôr cabeçalho, some <code>?token=</code> e a
              chave ao fim do endereço.
            </li>
            <li>
              Quem recebe: <code>email</code> (a Storefy acha o cliente na sua Shopify),{' '}
              <code>customerId</code> (o id do cliente na Shopify) ou <code>customerIds</code>, com
              até 50 clientes.
            </li>
            <li>
              Opcionais: <code>title</code> (até 120 caracteres) e <code>body</code> (até 400) — sem
              eles, vai o texto desta automação; <code>deepLink</code>, uma página da sua loja; e{' '}
              <code>id</code>, o id do evento, para uma entrega repetida não virar dois pushes.
            </li>
          </ul>
          <div className="space-y-1.5">
            <p>Exemplo de corpo, com o e-mail do cliente no Klaviyo:</p>
            <LinhaCopiavel valor={EXEMPLO} codigo />
          </div>
          <p className="text-muted-foreground">
            Respostas: <code>202</code> recebido, com quantos aparelhos vão receber;{' '}
            <code>401</code> chave errada ou desativada; <code>403</code> automação desligada;{' '}
            <code>422</code> não deu para achar o cliente pelo e-mail — a mensagem diz o que fazer.
          </p>
        </div>
      </details>

      <AlertDialog
        open={confirmando !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setConfirmando(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmando === 'desativar' ? 'Desativar a chave?' : 'Gerar uma chave nova?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmando === 'desativar'
                ? 'A sua ferramenta para de conseguir mandar push na hora: cada chamada volta recusada. Para voltar, é só gerar uma chave nova e trocar na ferramenta.'
                : 'A chave atual para de funcionar na hora. Troque pela nova na sua ferramenta logo em seguida, ou os pushes dela deixam de sair.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enviando}>Voltar</AlertDialogCancel>
            {/* As duas derrubam a chave em uso: o estilo destrutivo do botão vale para ambas. */}
            <AlertDialogAction
              disabled={enviando}
              onClick={(evento) => {
                evento.preventDefault();
                if (confirmando === 'desativar') desativar();
                else gerar();
              }}
            >
              {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {confirmando === 'desativar' ? 'Desativar' : 'Gerar chave nova'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

'use client';

/**
 * Conectar a conta Google (C13).
 *
 * Um arquivo só, mas com uma armadilha: o Google Cloud oferece dois JSON
 * parecidos na mesma tela, e o de credenciais OAuth é o que a maioria baixa
 * primeiro. A validação reconhece esse arquivo pelo nome do campo e diz onde
 * achar o certo, em vez de responder "JSON inválido".
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import type { ContaNaTela } from '@/lib/contas-de-desenvolvedor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CampoDeArquivo } from './campo-de-arquivo';
import { EstadoDaConta } from './estado-da-conta';
import { conectarGoogle, desconectarConta } from '../acoes';

export function CartaoDoGoogle({
  conta,
  podeEscrever,
}: {
  conta: ContaNaTela | null;
  podeEscrever: boolean;
}) {
  const router = useRouter();
  const [arquivo, setArquivo] = useState('');
  const [aberto, setAberto] = useState(false);
  const [enviando, iniciar] = useTransition();

  const conectada = conta?.status === 'verified';

  function enviar() {
    iniciar(async () => {
      const resultado = await conectarGoogle({ arquivo });
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Conta conectada.');
        setArquivo('');
        setAberto(false);
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível conectar.');
      }
      router.refresh();
    });
  }

  function remover() {
    iniciar(async () => {
      const resultado = await desconectarConta('google');
      if (resultado.ok === true) toast.success(resultado.mensagem ?? 'Desconectada.');
      else toast.error(resultado.mensagem ?? 'Não foi possível desconectar.');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Play className="size-4" aria-hidden />
              Google Play
            </CardTitle>
            <CardDescription>Publica o app na Play Store, para celulares Android.</CardDescription>
          </div>
          <EstadoDaConta conta={conta} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {conta !== null && conectada ? (
          <>
            <p className="text-muted-foreground text-sm">
              Tudo certo. A Storefy consegue enviar os builds para a sua conta do Play.
            </p>
            {conta.observacao === null ? null : (
              <p className="text-muted-foreground font-mono text-xs break-all">
                {conta.observacao}
              </p>
            )}
          </>
        ) : (
          <ol className="text-muted-foreground list-decimal space-y-1.5 pl-5 text-sm">
            <li>
              Tenha uma conta no <strong>Google Play Console</strong> (US$ 25, pagamento único).
            </li>
            <li>
              No Google Cloud, em <strong>IAM › Contas de serviço</strong>, crie uma conta e gere
              uma chave do tipo <strong>JSON</strong>.
            </li>
            <li>
              No Play Console, em <strong>Usuários e permissões</strong>, convide o e-mail dessa
              conta de serviço com permissão de publicar.
            </li>
            <li>
              Ative a <strong>Google Play Android Developer API</strong> no mesmo projeto do Google
              Cloud.
            </li>
          </ol>
        )}

        {podeEscrever ? (
          <Button
            type="button"
            variant={conectada ? 'outline' : 'default'}
            size="sm"
            onClick={() => {
              setAberto((anterior) => !anterior);
            }}
            aria-expanded={aberto}
          >
            {aberto ? 'Fechar' : conectada ? 'Enviar outro arquivo' : 'Conectar Google'}
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">
            Apenas proprietários e administradores conectam as contas.
          </p>
        )}

        {aberto ? (
          <form
            className="space-y-5 border-t pt-4"
            onSubmit={(evento) => {
              evento.preventDefault();
              enviar();
            }}
          >
            <CampoDeArquivo
              id="google-json"
              rotulo="Chave da conta de serviço (JSON)"
              aceita=".json,application/json"
              ajuda="Cuidado para não enviar o arquivo de credenciais OAuth: o certo vem de IAM › Contas de serviço › Chaves."
              valor={arquivo}
              aoMudar={setArquivo}
            />

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={enviando}>
                {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Validar e conectar
              </Button>
              {conectada ? (
                <Button type="button" variant="ghost" disabled={enviando} onClick={remover}>
                  Desconectar
                </Button>
              ) : null}
            </div>

            <p className="text-muted-foreground text-xs">
              O arquivo é guardado criptografado e nunca volta para a tela — nem para você. Para
              trocá-lo, envie outro.
            </p>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

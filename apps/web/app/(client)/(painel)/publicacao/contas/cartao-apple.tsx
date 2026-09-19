'use client';

/**
 * Conectar a conta Apple (C13).
 *
 * São DUAS chaves diferentes, e confundi-las é o erro número um deste
 * assistente: a da App Store Connect publica o app, a de APNs manda
 * notificação. As duas são arquivos `.p8` baixados de lugares diferentes do
 * mesmo site, com nomes parecidos.
 *
 * Por isso cada campo diz onde achar a sua, e a ação recusa quando os dois
 * arquivos enviados são iguais.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Apple, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ContaNaTela } from '@/lib/contas-de-desenvolvedor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CampoDeArquivo } from './campo-de-arquivo';
import { EstadoDaConta } from './estado-da-conta';
import { conectarApple, desconectarConta } from '../acoes';

const VAZIO = {
  ascP8: '',
  ascKeyId: '',
  ascIssuerId: '',
  teamId: '',
  apnsP8: '',
  apnsKeyId: '',
};

export function CartaoDaApple({
  conta,
  podeEscrever,
}: {
  conta: ContaNaTela | null;
  podeEscrever: boolean;
}) {
  const router = useRouter();
  const [valores, setValores] = useState(VAZIO);
  const [aberto, setAberto] = useState(false);
  const [enviando, iniciar] = useTransition();

  const conectada = conta?.status === 'verified';

  function enviar() {
    iniciar(async () => {
      const resultado = await conectarApple(valores);
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Conta conectada.');
        setValores(VAZIO);
        setAberto(false);
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível conectar.');
        router.refresh();
      }
    });
  }

  function remover() {
    iniciar(async () => {
      const resultado = await desconectarConta('apple');
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Desconectada.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível desconectar.');
      }
    });
  }

  const trocar = (campo: keyof typeof VAZIO, valor: string): void => {
    setValores((anteriores) => ({ ...anteriores, [campo]: valor }));
  };

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Apple className="size-4" aria-hidden />
              Apple
            </CardTitle>
            <CardDescription>
              Publica o app na App Store e envia as notificações para iPhone.
            </CardDescription>
          </div>
          <EstadoDaConta conta={conta} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {conectada ? (
          <p className="text-muted-foreground text-sm">
            Tudo certo. A Storefy consegue criar o registro do app, enviar os builds e acompanhar a
            revisão na sua conta.
          </p>
        ) : (
          <ol className="text-muted-foreground list-decimal space-y-1.5 pl-5 text-sm">
            <li>
              Tenha uma conta no <strong>Apple Developer Program</strong> (US$ 99 por ano, paga
              diretamente à Apple).
            </li>
            <li>
              No App Store Connect, em <strong>Usuários e Acesso › Integrações</strong>, gere uma
              chave de API com o papel <strong>Admin</strong> ou <strong>App Manager</strong>.
            </li>
            <li>
              Em <strong>Chaves › Notificações Push (APNs)</strong>, gere uma segunda chave, que é a
              das notificações.
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
            {aberto ? 'Fechar' : conectada ? 'Enviar chaves novas' : 'Conectar Apple'}
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
            <p className="text-sm font-medium">Chave da App Store Connect</p>

            <CampoDeArquivo
              id="asc-p8"
              rotulo="Arquivo .p8 da API"
              aceita=".p8,text/plain"
              ajuda="App Store Connect › Usuários e Acesso › Integrações › Chaves de API."
              valor={valores.ascP8}
              aoMudar={(texto) => {
                trocar('ascP8', texto);
              }}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="asc-key-id">Key ID</Label>
                <Input
                  id="asc-key-id"
                  value={valores.ascKeyId}
                  onChange={(evento) => {
                    trocar('ascKeyId', evento.target.value);
                  }}
                  placeholder="ABC123DEFG"
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="asc-issuer">Issuer ID</Label>
                <Input
                  id="asc-issuer"
                  value={valores.ascIssuerId}
                  onChange={(evento) => {
                    trocar('ascIssuerId', evento.target.value);
                  }}
                  placeholder="69a6de70-..."
                  className="font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="team-id">Team ID</Label>
              <Input
                id="team-id"
                value={valores.teamId}
                onChange={(evento) => {
                  trocar('teamId', evento.target.value);
                }}
                placeholder="A1B2C3D4E5"
                className="font-mono"
              />
              <p className="text-muted-foreground text-xs">
                Aparece no topo direito do site do Apple Developer, ao lado do nome da empresa.
              </p>
            </div>

            <p className="border-t pt-4 text-sm font-medium">Chave de notificações (APNs)</p>

            <CampoDeArquivo
              id="apns-p8"
              rotulo="Arquivo .p8 das notificações"
              aceita=".p8,text/plain"
              ajuda="É OUTRO arquivo: Certificados, Identificadores e Perfis › Chaves › Apple Push Notification service."
              valor={valores.apnsP8}
              aoMudar={(texto) => {
                trocar('apnsP8', texto);
              }}
            />

            <div className="space-y-2">
              <Label htmlFor="apns-key-id">Key ID das notificações</Label>
              <Input
                id="apns-key-id"
                value={valores.apnsKeyId}
                onChange={(evento) => {
                  trocar('apnsKeyId', evento.target.value);
                }}
                placeholder="XYZ987WVUT"
                className="font-mono"
              />
            </div>

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
              As chaves são guardadas criptografadas e nunca voltam para a tela — nem para você.
              Para trocá-las, envie outras.
            </p>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

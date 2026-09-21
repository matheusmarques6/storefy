'use client';

/**
 * O botão que publica uma correção em todas as lojas (A-OTA).
 *
 * É a ação mais ampla do produto: um clique muda o JavaScript do app de TODOS
 * os clientes na próxima abertura. A confirmação não é burocracia — ela diz em
 * quantas lojas isso vai mexer e que não há como desfazer sem publicar outra
 * correção por cima.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { MAXIMO_DA_MENSAGEM, mensagemValida } from '@/lib/ota';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/campo';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { publicarCorrecao } from './acoes';

export function FormularioDaOta({ bloqueado }: { bloqueado: boolean }) {
  const router = useRouter();
  const [texto, setTexto] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, iniciar] = useTransition();

  const valida = mensagemValida(texto);

  function publicar() {
    iniciar(async () => {
      const resultado = await publicarCorrecao(texto);
      setConfirmando(false);

      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Correção na fila.');
        setTexto('');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível publicar.');
      }
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Publicar uma correção</CardTitle>
          <CardDescription>
            Descreva o que foi corrigido. Esse texto aparece no painel do Expo ao lado da
            atualização — é o que alguém vai ler daqui a seis meses.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <Campo
            id="mensagem"
            rotulo="O que foi corrigido"
            dica={`${String(texto.trim().length)} de ${String(MAXIMO_DA_MENSAGEM)} caracteres.`}
          >
            <Input
              id="mensagem"
              name="mensagem"
              value={texto}
              maxLength={MAXIMO_DA_MENSAGEM}
              disabled={bloqueado || enviando}
              onChange={(evento) => {
                setTexto(evento.target.value);
              }}
              placeholder="Corrige o carrinho que não abria no iPhone"
            />
          </Campo>

          {/*
            Com uma rodada em andamento o botão sai da tela e o motivo entra no
            lugar. Um botão desabilitado sem explicação faz a pessoa clicar três
            vezes achando que a tela travou.
          */}
          {bloqueado ? (
            <p className="text-muted-foreground text-sm">
              Já existe uma correção sendo publicada. Espere ela terminar para publicar outra — duas
              ao mesmo tempo podem deixar uma loja com a versão mais velha.
            </p>
          ) : (
            <Button
              type="button"
              disabled={!valida || enviando}
              onClick={() => {
                setConfirmando(true);
              }}
            >
              {enviando ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" aria-hidden />
              )}
              Publicar em todas as lojas
            </Button>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publicar em todas as lojas?</AlertDialogTitle>
            <AlertDialogDescription>
              O app de todos os clientes vai baixar este JavaScript na próxima abertura. Não dá para
              desfazer: a única volta é publicar outra correção por cima.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enviando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(evento) => {
                evento.preventDefault();
                publicar();
              }}
              disabled={enviando}
            >
              {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Publicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

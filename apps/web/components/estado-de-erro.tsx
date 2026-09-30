'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { relatarNoNavegador } from '@/lib/erros-do-navegador';
import { FRASE_DO_ERRO, situacaoDoErro, type SituacaoDoErro } from '@/lib/erros';

/**
 * Estado de erro reutilizável (regra 7 do CLAUDE.md).
 *
 * A frase é para o lojista, e não a do motor. Ela mostrava `erro.message`, na
 * crença de que a mensagem real era acionável; só que em produção o Next
 * troca toda mensagem de erro do servidor por uma frase em inglês ("An error
 * occurred in the Server Components render…"), e os erros do navegador ("Failed
 * to fetch", o pedaço do painel que sumiu numa atualização) também chegavam em
 * inglês técnico. Agora cada caso conhecido tem a sua frase (`situacaoDoErro`),
 * o erro do servidor leva o código para o suporte achar no log, e o painel
 * atualizado pede para recarregar — "Tentar de novo" não traria o que sumiu.
 */
export function EstadoDeErro({
  erro,
  tentarDeNovo,
  voltarPara = '/',
  rotuloVoltar = 'Voltar para o início',
}: {
  erro: Error & { digest?: string };
  tentarDeNovo: () => void;
  voltarPara?: string;
  rotuloVoltar?: string;
}) {
  useEffect(() => {
    console.error(erro);
    // Erro com `digest` veio do servidor, que já relatou; o resto quebrou só
    // aqui no navegador, e sem isto ninguém veria.
    relatarNoNavegador(erro, 'tela', window.location.pathname);
  }, [erro]);

  const situacao = situacaoDoErro(erro);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <Alert variant="destructive" className="max-w-lg text-left">
        <AlertCircle aria-hidden />
        <AlertDescription>
          {fraseDaTela(erro, situacao)}
          {erro.digest == null ? null : (
            <span className="mt-2 block font-mono text-xs opacity-70">Código: {erro.digest}</span>
          )}
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap justify-center gap-2">
        {situacao === 'painel-atualizado' ? (
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            <RotateCcw aria-hidden />
            Recarregar a página
          </Button>
        ) : (
          <Button onClick={tentarDeNovo}>
            <RotateCcw aria-hidden />
            Tentar de novo
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link href={voltarPara}>{rotuloVoltar}</Link>
        </Button>
      </div>
    </div>
  );
}

/** A frase da tela de erro para cada situação. */
function fraseDaTela(erro: Error & { digest?: string }, situacao: SituacaoDoErro): string {
  switch (situacao) {
    case 'para-a-tela':
      return erro.message;
    case 'painel-atualizado':
    case 'sem-conexao':
      return FRASE_DO_ERRO[situacao];
    case 'servidor':
      return erro.digest == null
        ? 'Não foi possível carregar esta tela agora. Tente de novo em instantes; se continuar, fale com o suporte.'
        : 'Não foi possível carregar esta tela agora. Tente de novo em instantes; se continuar, fale com o suporte e informe o código abaixo.';
    case 'outro':
      return 'Algo deu errado nesta tela. Tente de novo; se continuar, fale com o suporte.';
  }
}

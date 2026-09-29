'use client';

/**
 * A barra fixa do editor (C06): como está o rascunho e o botão de publicar.
 *
 * O rascunho se salva sozinho (seção 10 do plano), e a barra diz se salvou,
 * se está salvando, ou por que não conseguiu — com o "tentar de novo" ali
 * mesmo. "Publicar alterações" mostra quantas mudanças vão ao ar, e só
 * funciona com o rascunho salvo: publicar lê o rascunho DO BANCO, e publicar
 * com uma alteração ainda não gravada poria no ar a versão anterior dela.
 */
import { AlertCircle, Check, Loader2, Rocket } from 'lucide-react';
import { formatarHora } from '@/lib/fuso';
import { descricaoDasMudancas } from '@/lib/mudancas-pendentes';
import { Button } from '@/components/ui/button';

export type SituacaoDoRascunho =
  /** Tudo gravado. `em` é quando, se foi nesta visita. */
  | { tipo: 'salvo'; em: Date | null }
  /** Mudou, e a gravação sai quando a pessoa parar de mexer. */
  | { tipo: 'pendente' }
  | { tipo: 'salvando' }
  /** Há ponto a corrigir: gravar poria no rascunho algo que não vai ao ar. */
  | { tipo: 'com-problemas' }
  | { tipo: 'erro'; mensagem: string };

interface Props {
  situacao: SituacaoDoRascunho;
  /** A versão no ar, ou `null` se o app nunca foi publicado. */
  versaoNoAr: number | null;
  /** Mudanças desde a versão no ar; `null` quando não há com o que comparar. */
  mudancas: number | null;
  publicando: boolean;
  /** O fuso da loja, para a hora do "salvo às". */
  fuso: string;
  aoTentarDeNovo: () => void;
  aoPublicar: () => void;
}

export function BarraDePublicacao({
  situacao,
  versaoNoAr,
  mudancas,
  publicando,
  fuso,
  aoTentarDeNovo,
  aoPublicar,
}: Props) {
  const temOQuePublicar = versaoNoAr === null || mudancas === null || mudancas > 0;
  const podePublicar = situacao.tipo === 'salvo' && temOQuePublicar && !publicando;

  return (
    <div
      role="region"
      aria-label="Publicação do app"
      className="bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t p-3 backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="flex flex-wrap items-center gap-1.5 text-sm" aria-live="polite">
            <Situacao situacao={situacao} fuso={fuso} />
            {situacao.tipo === 'erro' ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={aoTentarDeNovo}
              >
                Tentar de novo
              </Button>
            ) : null}
          </p>
          <p className="text-muted-foreground text-xs">
            {versaoNoAr === null
              ? 'Ainda não publicado: publique para o app usar esta configuração.'
              : mudancas === null
                ? `A versão ${String(versaoNoAr)} está no ar.`
                : descricaoDasMudancas(mudancas)}
          </p>
        </div>

        <Button type="button" disabled={!podePublicar} onClick={aoPublicar}>
          {publicando ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Rocket className="size-4" aria-hidden />
          )}
          {publicando ? 'Publicando…' : 'Publicar alterações'}
          {mudancas !== null && mudancas > 0 && !publicando ? (
            <span
              aria-hidden
              className="bg-primary-foreground/20 rounded-full px-1.5 text-xs tabular-nums"
            >
              {mudancas}
            </span>
          ) : null}
        </Button>
      </div>
    </div>
  );
}

function Situacao({ situacao, fuso }: { situacao: SituacaoDoRascunho; fuso: string }) {
  switch (situacao.tipo) {
    case 'salvo':
      return (
        <>
          <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <span>
            {situacao.em === null
              ? 'Rascunho salvo.'
              : `Rascunho salvo às ${formatarHora(situacao.em, fuso)}.`}
          </span>
        </>
      );
    case 'pendente':
    case 'salvando':
      return (
        <>
          <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden />
          <span className="text-muted-foreground">Salvando o rascunho…</span>
        </>
      );
    case 'com-problemas':
      return (
        <>
          <AlertCircle className="text-destructive size-4" aria-hidden />
          <span>Corrija os pontos destacados para o rascunho ser salvo.</span>
        </>
      );
    case 'erro':
      return (
        <>
          <AlertCircle className="text-destructive size-4" aria-hidden />
          <span>{situacao.mensagem}</span>
        </>
      );
  }
}

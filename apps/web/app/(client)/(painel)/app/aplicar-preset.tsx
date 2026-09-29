'use client';

/**
 * Aplicar um preset de tema (A10, lado do lojista).
 *
 * É o que transforma a curadoria do admin em tempo poupado: descobrir quais
 * seletores escondem o cabeçalho do tema Dawn é o passo mais lento do
 * onboarding, e alguém já o fez na primeira loja daquele tema.
 *
 * A CONFIRMAÇÃO MOSTRA O ESTRAGO, e não um "tem certeza?" vazio. Aplicar
 * SUBSTITUI as abas que o lojista montou — se ele passou a tarde nelas,
 * precisa ver isso antes de clicar, não depois. `resumoDaTroca` escreve
 * exatamente o que sai e o que entra.
 *
 * Nada é publicado aqui: a troca acontece no RASCUNHO, e continua reversível
 * pelo "Desfazer mudanças" da barra do editor enquanto ele não publicar — que
 * volta o rascunho ao que está no ar.
 */
import { useState, useTransition } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AppConfig } from '@storefy/config-schema';
import {
  aplicarPreset,
  presetDoTema,
  presetsPeloTema,
  resumoDaTroca,
  type Preset,
} from '@/lib/presets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { descobrirTemaDaLoja } from './acoes';
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

export function AplicarPreset({
  config,
  presets,
  storeId,
  temaDaLoja,
  lojaNaShopify,
  aoMudar,
  somenteLeitura,
}: {
  config: AppConfig;
  presets: Preset[];
  storeId: string;
  /** O tema da Shopify que a loja usa (A10): o preset dele vem primeiro, marcado. */
  temaDaLoja: string | null;
  lojaNaShopify: boolean;
  aoMudar: (config: AppConfig) => void;
  somenteLeitura: boolean;
}) {
  const [escolhido, setEscolhido] = useState<Preset | null>(null);
  const [tema, setTema] = useState(temaDaLoja);
  const [falhaDoTema, setFalhaDoTema] = useState<string | null>(null);
  const [lendoTema, iniciarLeitura] = useTransition();

  if (presets.length === 0) return null;

  const ordenados = presetsPeloTema(presets, tema);
  const algumDoTema = ordenados.some((preset) => presetDoTema(preset, tema));

  function descobrir() {
    setFalhaDoTema(null);
    iniciarLeitura(async () => {
      const resultado = await descobrirTemaDaLoja(storeId);
      if (resultado.ok === true && resultado.tema !== undefined) {
        setTema(resultado.tema);
        toast.success(`Sua loja usa o tema ${resultado.tema}.`);
        return;
      }
      setFalhaDoTema(resultado.mensagem ?? 'Não conseguimos ler o tema agora. Tente de novo.');
    });
  }

  function aplicar(preset: Preset) {
    const resultado = aplicarPreset(config, preset);
    setEscolhido(null);

    if (!resultado.ok) {
      toast.error(resultado.motivo);
      return;
    }

    aoMudar(resultado.config);
    toast.success(`Preset "${preset.nome}" aplicado. Publique quando estiver bom.`);
  }

  const mudancas = escolhido == null ? [] : resumoDaTroca(config, escolhido);

  return (
    <div className="border-input space-y-3 rounded-lg border p-3">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Layers className="size-4 shrink-0" aria-hidden />
          Começar de um preset
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          Cada tema da Shopify esconde o cabeçalho e o rodapé de um jeito. Se o seu está na lista,
          aplique e pule essa parte.
        </p>
      </div>

      {lojaNaShopify ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p data-testid="tema-da-loja">
            {tema === null ? (
              'Ainda não sabemos qual tema a sua loja usa.'
            ) : (
              <>
                Sua loja usa o tema <strong>{tema}</strong>.
                {algumDoTema
                  ? null
                  : ' Ainda não há preset para ele; os outros podem servir de ponto de partida.'}
              </>
            )}
          </p>
          {somenteLeitura ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={lendoTema}
              onClick={descobrir}
            >
              {lendoTema ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {tema === null ? 'Descobrir o tema da minha loja' : 'Ler o tema de novo'}
            </Button>
          )}
        </div>
      ) : null}
      {falhaDoTema === null ? null : (
        <p role="alert" className="text-destructive text-sm">
          {falhaDoTema}
        </p>
      )}

      <ul className="space-y-2">
        {ordenados.map((preset) => (
          <li key={preset.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {preset.nome}
              {presetDoTema(preset, tema) ? (
                <Badge variant="secondary" className="ml-2">
                  Feito para o seu tema
                </Badge>
              ) : null}
              <span className="text-muted-foreground mt-0.5 block text-xs">
                {preset.descricao ?? `Para o tema ${preset.tema}.`}
              </span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={somenteLeitura}
              onClick={() => {
                setEscolhido(preset);
              }}
            >
              Aplicar
            </Button>
          </li>
        ))}
      </ul>

      <AlertDialog
        open={escolhido != null}
        onOpenChange={(aberto) => {
          if (!aberto) setEscolhido(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar “{escolhido?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {mudancas.length === 0 ? (
                  <p>Sua configuração já está igual à deste preset. Nada muda.</p>
                ) : (
                  <>
                    <p>O que muda:</p>
                    <ul className="list-disc space-y-1 pl-5">
                      {mudancas.map((mudanca) => (
                        <li key={mudanca}>{mudanca}</li>
                      ))}
                    </ul>
                    <p>
                      Suas cores, nome, ícone e recursos ficam como estão. Nada é publicado agora, e
                      &quot;Desfazer mudanças&quot;, na barra de baixo do editor, volta ao que está
                      no ar.
                    </p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(evento) => {
                evento.preventDefault();
                if (escolhido != null) aplicar(escolhido);
              }}
            >
              Aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

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
 * pelo botão de descartar do editor enquanto ele não publicar.
 */
import { useState } from 'react';
import { Layers } from 'lucide-react';
import { toast } from 'sonner';
import type { AppConfig } from '@storefy/config-schema';
import { aplicarPreset, resumoDaTroca, type Preset } from '@/lib/presets';
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

export function AplicarPreset({
  config,
  presets,
  aoMudar,
  somenteLeitura,
}: {
  config: AppConfig;
  presets: Preset[];
  aoMudar: (config: AppConfig) => void;
  somenteLeitura: boolean;
}) {
  const [escolhido, setEscolhido] = useState<Preset | null>(null);

  if (presets.length === 0) return null;

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

      <ul className="space-y-2">
        {presets.map((preset) => (
          <li key={preset.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {preset.nome}
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
                      Suas cores, nome, ícone e recursos ficam como estão. Nada é publicado agora —
                      dá para descartar antes de publicar.
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

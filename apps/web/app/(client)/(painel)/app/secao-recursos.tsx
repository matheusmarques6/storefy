'use client';

/** Boas-vindas, banner e recursos do app (C06d). */
import { Plus, Trash2 } from 'lucide-react';
import type { AppConfig } from '@storefy/config-schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { editarRecursos } from '@/lib/editor-de-config';

const MAX_SLIDES = 4;

export function SecaoRecursos({
  config,
  aoMudar,
  somenteLeitura,
  pushConfigurado,
}: {
  config: AppConfig;
  aoMudar: (config: AppConfig) => void;
  somenteLeitura: boolean;
  /** O app já tem push ligado? Muda o que o momento do pedido significa. */
  pushConfigurado: boolean;
}) {
  const { features } = config;

  function trocarSlide(
    indice: number,
    mudanca: Partial<AppConfig['features']['onboardingSlides'][number]>,
  ) {
    const slides = features.onboardingSlides.map((slide, i) =>
      i === indice ? { ...slide, ...mudanca } : slide,
    );
    aoMudar(editarRecursos(config, { onboardingSlides: slides }));
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Boas-vindas</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Até {MAX_SLIDES} telas que aparecem uma vez só, na primeira abertura. Sem nenhuma, o app
            vai direto para a loja.
          </p>
        </div>

        {features.onboardingSlides.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
            Nenhuma tela de boas-vindas. O cliente cai direto na loja.
          </p>
        ) : (
          <ul className="space-y-3">
            {features.onboardingSlides.map((slide, indice) => (
              <li key={indice} className="space-y-3 rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Tela {indice + 1}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remover tela ${String(indice + 1)}`}
                    disabled={somenteLeitura}
                    onClick={() => {
                      aoMudar(
                        editarRecursos(config, {
                          onboardingSlides: features.onboardingSlides.filter(
                            (_, i) => i !== indice,
                          ),
                        }),
                      );
                    }}
                  >
                    <Trash2 className="text-destructive size-4" aria-hidden />
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`slide-${String(indice)}-titulo`}>Título</Label>
                  <Input
                    id={`slide-${String(indice)}-titulo`}
                    value={slide.title}
                    disabled={somenteLeitura}
                    onChange={(evento) => {
                      trocarSlide(indice, { title: evento.target.value });
                    }}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`slide-${String(indice)}-texto`}>Texto</Label>
                  <Textarea
                    id={`slide-${String(indice)}-texto`}
                    value={slide.body}
                    className="min-h-16"
                    disabled={somenteLeitura}
                    onChange={(evento) => {
                      trocarSlide(indice, { body: evento.target.value });
                    }}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`slide-${String(indice)}-imagem`}>Imagem (endereço)</Label>
                  <Input
                    id={`slide-${String(indice)}-imagem`}
                    value={slide.image}
                    placeholder="https://..."
                    spellCheck={false}
                    disabled={somenteLeitura}
                    onChange={(evento) => {
                      trocarSlide(indice, { image: evento.target.value });
                    }}
                  />
                  <p className="text-muted-foreground text-xs">
                    Opcional. Deixe em branco para a tela ficar só com título e texto.
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {somenteLeitura || features.onboardingSlides.length >= MAX_SLIDES ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              aoMudar(
                editarRecursos(config, {
                  onboardingSlides: [
                    ...features.onboardingSlides,
                    { title: '', body: '', image: '' },
                  ],
                }),
              );
            }}
          >
            <Plus className="size-4" aria-hidden />
            Adicionar tela
          </Button>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Banner “baixe o app”</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Faixa exibida no site para quem ainda não instalou.
            </p>
          </div>
          <Switch
            aria-label="Banner baixe o app"
            checked={features.appBanner.enabled}
            disabled={somenteLeitura}
            onCheckedChange={(proximo) => {
              aoMudar(
                editarRecursos(config, {
                  appBanner: { ...features.appBanner, enabled: proximo },
                }),
              );
            }}
          />
        </div>

        {features.appBanner.enabled ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="texto-do-banner">Texto do banner</Label>
              <Input
                id="texto-do-banner"
                value={features.appBanner.text}
                placeholder="Compre mais rápido pelo nosso app"
                disabled={somenteLeitura}
                onChange={(evento) => {
                  aoMudar(
                    editarRecursos(config, {
                      appBanner: { ...features.appBanner, text: evento.target.value },
                    }),
                  );
                }}
              />
            </div>

            {/*
              Esta chave sozinha não põe a faixa no ar: ela também precisa ser
              ligada UMA VEZ no editor de tema da Shopify, porque é de lá que o
              bloco roda. Sem este aviso, o lojista ligaria aqui, não veria nada
              no site e concluiria que o produto está quebrado.
            */}
            <p className="text-muted-foreground border-input rounded-lg border p-3 text-xs">
              Falta um passo na Shopify: em <strong>Loja virtual › Temas › Personalizar</strong>,
              abra <strong>Configurações do app</strong> e ligue o bloco <strong>Storefy</strong>. É
              uma vez só — depois o texto e os links saem daqui.
            </p>
          </div>
        ) : null}
      </section>

      <section className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="momento-do-push">Quando pedir permissão de notificações</Label>
          <Select
            id="momento-do-push"
            value={features.pushPromptTiming}
            disabled={somenteLeitura || !pushConfigurado}
            onChange={(evento) => {
              const valor = evento.target.value;
              aoMudar(
                editarRecursos(config, {
                  pushPromptTiming:
                    valor === 'after_first_add_to_cart'
                      ? 'after_first_add_to_cart'
                      : valor === 'manual'
                        ? 'manual'
                        : 'onboarding',
                }),
              );
            }}
          >
            <option value="onboarding">Logo nas boas-vindas</option>
            <option value="after_first_add_to_cart">Depois do primeiro item no carrinho</option>
            <option value="manual">Só quando a loja pedir</option>
          </Select>
          <p className="text-muted-foreground text-xs">
            {pushConfigurado
              ? 'O sistema mostra esse pedido uma vez só. Depois do primeiro item no carrinho costuma ter a melhor aceitação.'
              : 'As notificações ainda não estão configuradas neste app. Esta escolha passa a valer quando estiverem.'}
          </p>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Pedir avaliação na loja de aplicativos</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Aparece depois de uma compra concluída, no momento em que o cliente mais gosta do app.
            </p>
          </div>
          <Switch
            aria-label="Pedir avaliação na loja de aplicativos"
            checked={features.rateAppPrompt}
            disabled={somenteLeitura}
            onCheckedChange={(proximo) => {
              aoMudar(editarRecursos(config, { rateAppPrompt: proximo }));
            }}
          />
        </div>
      </section>
    </div>
  );
}

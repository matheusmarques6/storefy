'use client';

/** Boas-vindas e permissões (C06d); banner, aviso no topo e recursos do app (C06e). */
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { AppConfig } from '@storefy/config-schema';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  MAX_SLIDES,
  MAX_TEXTO_DO_AVISO,
  MAX_TEXTO_DO_SLIDE,
  MAX_TITULO_DO_SLIDE,
  avisoDaConfig,
  editarAviso,
  editarRecursos,
} from '@/lib/editor-de-config';
import { ImagemDoSlide } from './imagem-do-slide';
import { SecaoAtualizacao } from './secao-atualizacao';

/**
 * O que o app faz com cada escolha, dito como o app faz (`apps/mobile/src/push/permissao.ts`).
 * A opção dizia "logo nas boas-vindas", e o app — de propósito — não pergunta na
 * primeira abertura, quando o cliente ainda nem viu a loja.
 */
const EXPLICACAO_DO_MOMENTO: Record<AppConfig['features']['pushPromptTiming'], string> = {
  onboarding:
    'A partir da segunda abertura do app: na primeira, o cliente ainda está conhecendo a loja. Se ele puser algo no carrinho antes, o pedido aparece ali.',
  after_first_add_to_cart:
    'Quando o cliente põe o primeiro item no carrinho — costuma ter a melhor aceitação.',
  manual: 'Só quando uma página da loja pedir, por um botão como "me avise".',
};

export function SecaoRecursos({
  storeId,
  config,
  aoMudar,
  somenteLeitura,
  pushConfigurado,
  numeroExigivel,
  aoVerSlide,
}: {
  storeId: string;
  config: AppConfig;
  aoMudar: (config: AppConfig) => void;
  /** O lojista está numa tela de boas-vindas: a prévia vai até ela. */
  aoVerSlide?: (indice: number) => void;
  somenteLeitura: boolean;
  /** O app já tem push ligado? Muda o que o momento do pedido significa. */
  pushConfigurado: boolean;
  /** O último número aprovado nas duas lojas. Ver `SecaoAtualizacao`. */
  numeroExigivel: number | null;
}) {
  const { features } = config;
  const aviso = avisoDaConfig(config);
  const temAbaConta = config.tabs.some((aba) => aba.type === 'account');

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
              <li
                key={indice}
                className="space-y-3 rounded-xl border p-4"
                // O foco em qualquer campo da tela leva a prévia até ela.
                onFocus={() => aoVerSlide?.(indice)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Tela {indice + 1}</span>
                  <RemoverSlide
                    numero={indice + 1}
                    // Uma tela em branco sai direto; a escrita, só confirmando.
                    temConteudo={
                      slide.title.trim() !== '' ||
                      slide.body.trim() !== '' ||
                      slide.image.trim() !== ''
                    }
                    desabilitado={somenteLeitura}
                    aoRemover={() => {
                      aoMudar(
                        editarRecursos(config, {
                          onboardingSlides: features.onboardingSlides.filter(
                            (_, i) => i !== indice,
                          ),
                        }),
                      );
                    }}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`slide-${String(indice)}-titulo`}>Título</Label>
                  <Input
                    id={`slide-${String(indice)}-titulo`}
                    value={slide.title}
                    placeholder="Bem-vindo à loja"
                    disabled={somenteLeitura}
                    aria-describedby={`slide-${String(indice)}-titulo-ajuda`}
                    onChange={(evento) => {
                      trocarSlide(indice, { title: evento.target.value });
                    }}
                  />
                  <Contador
                    id={`slide-${String(indice)}-titulo-ajuda`}
                    texto={slide.title}
                    maximo={MAX_TITULO_DO_SLIDE}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`slide-${String(indice)}-texto`}>Texto</Label>
                  <Textarea
                    id={`slide-${String(indice)}-texto`}
                    value={slide.body}
                    placeholder="Frete grátis na primeira compra pelo app."
                    className="min-h-16"
                    disabled={somenteLeitura}
                    aria-describedby={`slide-${String(indice)}-texto-ajuda`}
                    onChange={(evento) => {
                      trocarSlide(indice, { body: evento.target.value });
                    }}
                  />
                  <Contador
                    id={`slide-${String(indice)}-texto-ajuda`}
                    texto={slide.body}
                    maximo={MAX_TEXTO_DO_SLIDE}
                  />
                </div>

                <ImagemDoSlide
                  storeId={storeId}
                  indice={indice}
                  url={slide.image}
                  fundo={config.theme.background}
                  somenteLeitura={somenteLeitura}
                  aoMudar={(url) => {
                    trocarSlide(indice, { image: url });
                  }}
                />
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
              aoVerSlide?.(features.onboardingSlides.length);
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
              abra o ícone de apps na barra da esquerda e ligue o <strong>Banner do app</strong>, da
              Storefy. É uma vez só — depois o texto e os links saem daqui. A faixa aparece quando o
              app estiver na App Store ou na Play Store, com o link só da loja em que ele já está, e
              só no celular de quem ainda não tem o app.
            </p>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Aviso no topo</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Uma faixa curta em cima da loja, dentro do app: frete grátis, uma promoção, o prazo de
              entrega. O cliente pode fechar, e um texto novo volta a aparecer.
            </p>
          </div>
          <Switch
            aria-label="Aviso no topo"
            checked={aviso.enabled}
            disabled={somenteLeitura}
            onCheckedChange={(proximo) => {
              aoMudar(editarAviso(config, { enabled: proximo }));
            }}
          />
        </div>

        {aviso.enabled ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="texto-do-aviso">Texto do aviso</Label>
              <Input
                id="texto-do-aviso"
                value={aviso.text}
                placeholder="Frete grátis acima de R$ 199"
                disabled={somenteLeitura}
                aria-describedby="texto-do-aviso-ajuda"
                onChange={(evento) => {
                  aoMudar(editarAviso(config, { text: evento.target.value }));
                }}
              />
              <p
                id="texto-do-aviso-ajuda"
                className={
                  aviso.text.trim().length > MAX_TEXTO_DO_AVISO
                    ? 'text-destructive text-xs'
                    : 'text-muted-foreground text-xs'
                }
              >
                {aviso.text.trim().length} de {MAX_TEXTO_DO_AVISO} caracteres.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="link-do-aviso">Link do aviso (opcional)</Label>
              <Input
                id="link-do-aviso"
                value={aviso.url ?? ''}
                placeholder="/collections/promocao"
                disabled={somenteLeitura}
                aria-describedby="link-do-aviso-ajuda"
                onChange={(evento) => {
                  aoMudar(editarAviso(config, { url: evento.target.value }));
                }}
              />
              <p id="link-do-aviso-ajuda" className="text-muted-foreground text-xs">
                Um endereço da sua loja. Quem tocar no aviso vai para lá; sem link, ele é só texto.
              </p>
            </div>
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
            <option value="onboarding">Nas primeiras aberturas do app</option>
            <option value="after_first_add_to_cart">Depois do primeiro item no carrinho</option>
            <option value="manual">Só quando a loja pedir</option>
          </Select>
          <p className="text-muted-foreground text-xs">
            {pushConfigurado
              ? `${EXPLICACAO_DO_MOMENTO[features.pushPromptTiming]} O sistema mostra esse pedido uma vez só. Antes dele, o app explica o que o cliente vai receber: as promoções e os avisos das automações que você deixou ligadas.`
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

        {/*
          M06: a trava fica na aba Conta. Sem ela não há o que proteger — a
          chave desliga, mas continua podendo ser desligada, para ninguém ficar
          com um recurso ligado que não consegue mais desligar.
        */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Proteger a conta com Face ID ou digital</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {temAbaConta
                ? 'Para ver os pedidos e os dados na aba Conta, o cliente confirma com o rosto, a digital ou a senha do celular. Em celular sem nada disso cadastrado, a aba abre normalmente.'
                : 'Precisa da aba Conta, que é a parte protegida. Adicione-a em Abas para usar.'}
            </p>
          </div>
          <Switch
            aria-label="Proteger a conta com Face ID ou digital"
            checked={features.biometricLogin}
            disabled={somenteLeitura || (!temAbaConta && !features.biometricLogin)}
            onCheckedChange={(proximo) => {
              aoMudar(editarRecursos(config, { biometricLogin: proximo }));
            }}
          />
        </div>
      </section>

      <SecaoAtualizacao
        config={config}
        aoMudar={aoMudar}
        somenteLeitura={somenteLeitura}
        numeroExigivel={numeroExigivel}
      />
    </div>
  );
}

/** Quantos caracteres o campo tem, em vermelho quando passa do que cabe na tela. */
function Contador({ id, texto, maximo }: { id: string; texto: string; maximo: number }) {
  const tamanho = texto.trim().length;
  return (
    <p
      id={id}
      className={tamanho > maximo ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}
    >
      {tamanho} de {maximo} caracteres.
    </p>
  );
}

/**
 * Tirar uma tela de boas-vindas. A que tem texto ou imagem pede confirmação:
 * o rascunho grava sozinho, e o que foi escrito ali não volta.
 */
function RemoverSlide({
  numero,
  temConteudo,
  desabilitado,
  aoRemover,
}: {
  numero: number;
  temConteudo: boolean;
  desabilitado: boolean;
  aoRemover: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={`Remover tela ${String(numero)}`}
        disabled={desabilitado}
        onClick={() => {
          if (temConteudo) setConfirmando(true);
          else aoRemover();
        }}
      >
        <Trash2 className="text-destructive size-4" aria-hidden />
      </Button>
      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover a tela {numero}?</AlertDialogTitle>
            <AlertDialogDescription>
              O título, o texto e a imagem desta tela saem do rascunho. Os clientes só deixam de
              vê-la quando você publicar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                aoRemover();
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

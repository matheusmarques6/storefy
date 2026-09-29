'use client';

/**
 * Prévia do app (C06).
 *
 * Desenha a moldura do celular, a barra de status e a tab bar exatamente com as
 * cores e as abas da config sendo editada. O miolo é a loja, carregada por
 * `/api/preview-proxy` — pelo proxy e não direto porque muita loja manda
 * `X-Frame-Options`, e o iframe apontado para o site cru ficaria em branco sem
 * dizer por quê.
 *
 * A moldura alterna entre iPhone e Android (seção 10 do plano): a ilha no
 * topo e o indicador de início de um, a câmera furada e a barra de gestos do
 * outro. A escolha é de quem olha e fica no navegador (`aparelho-da-previa`).
 * Claro e escuro não entram: o app roda sempre claro (`userInterfaceStyle`
 * do `app.config.ts`), com as cores da loja — um modo escuro na prévia
 * mostraria um app que não existe.
 *
 * O iframe é `sandbox` SEM `allow-same-origin`, de propósito. O documento sai
 * da nossa origem, e deixá-lo mantê-la daria ao tema do lojista — e a todo
 * script de terceiro instalado nele — acesso aos cookies e ao armazenamento do
 * painel. Em troca, o painel não alcança o documento, e o que esconder viaja
 * por `postMessage`. Fica mais chato de escrever e evita entregar a sessão de
 * quem está editando.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfig } from '@storefy/config-schema';
import { X } from 'lucide-react';
import { useAparelhoDaPrevia } from '@/lib/aparelho-da-previa';
import { MARCA_DA_PREVIA, cssDaPrevia } from '@/lib/preview-proxy';
import { cn } from '@/lib/utils';
import { IconeDaAba } from './icone-da-aba';
import {
  AberturaNaPrevia,
  TelaInicialNaPrevia,
  type IdentidadeNaPrevia,
} from './previa-da-identidade';

/** O que a moldura mostra: a loja, o ícone na tela inicial ou a abertura. */
type Vista = 'loja' | 'icone' | 'abertura';

const ROTULO_DA_VISTA: Record<Vista, string> = {
  loja: 'Loja',
  icone: 'Ícone',
  abertura: 'Abertura',
};

/**
 * O caminho da loja que a prévia mostra para uma aba — o mesmo que o app abre.
 * Usado pelo editor (C06) e pelo visual rápido do começo (C03).
 */
export function caminhoDaPrevia(config: AppConfig, abaId: string): string {
  const aba = config.tabs.find((item) => item.id === abaId);
  if (aba === undefined) return '/';
  if (aba.type === 'webview') return aba.url ?? '/';
  if (aba.type === 'cart') return '/cart';
  if (aba.type === 'account') return '/account';
  if (aba.type === 'search') return '/search';
  return '/';
}

interface Props {
  config: AppConfig;
  abaAtiva: string;
  aoTrocarAba: (id: string) => void;
  lojaId: string;
  /** Caminho da loja a exibir. Muda ao trocar a aba destacada. */
  caminho: string;
  /** Modo "clicar para esconder" ligado. */
  selecionando: boolean;
  /** Chamado com o seletor do que o lojista clicou. */
  aoEscolherSeletor: (seletor: string) => void;
  /**
   * O ícone e a abertura (C06a). Com eles, a prévia ganha as vistas "Ícone"
   * e "Abertura"; sem eles (o começo, C03), fica só a loja.
   */
  identidade?: IdentidadeNaPrevia;
}

export function Previa({
  config,
  abaAtiva,
  aoTrocarAba,
  lojaId,
  caminho,
  selecionando,
  aoEscolherSeletor,
  identidade,
}: Props) {
  const { theme } = config;
  const [vistaEscolhida, setVista] = useState<Vista>('loja');
  // Escolher o que esconder é na loja: a vista volta para ela.
  const vista = identidade === undefined || selecionando ? 'loja' : vistaEscolhida;
  const ativa = config.tabs.find((aba) => aba.id === abaAtiva) ?? config.tabs[0];
  const iframe = useRef<HTMLIFrameElement>(null);
  const [aparelho, trocarAparelho] = useAparelhoDaPrevia();
  const ehIphone = aparelho === 'iphone';
  // O aviso no topo (C06e), como o app desenha: só ligado e com texto.
  const aviso = config.announcement?.enabled === true ? config.announcement.text.trim() : '';

  /*
   * Os seletores entram na URL só para a primeira pintura não piscar com o
   * cabeçalho do tema, e por isso são capturados na montagem. Depois disso,
   * quem manda é o `postMessage`, que atualiza sem recarregar: se a URL
   * dependesse deles, cada tecla digitada recarregaria a loja inteira.
   */
  const [seletoresIniciais] = useState(() => config.webview.hideSelectors);

  const src = useMemo(() => {
    const parametros = new URLSearchParams({ loja: lojaId, caminho });
    for (const seletor of seletoresIniciais) {
      if (seletor.trim() !== '') parametros.append('esconder', seletor);
    }
    return `/api/preview-proxy?${parametros.toString()}`;
  }, [caminho, lojaId, seletoresIniciais]);

  const css = useMemo(
    () => [cssDaPrevia(config.webview.hideSelectors), config.webview.customCss].join('\n'),
    [config.webview.customCss, config.webview.hideSelectors],
  );

  const enviarEstado = useCallback(() => {
    const janela = iframe.current?.contentWindow;
    if (janela == null) return;
    janela.postMessage({ fonte: MARCA_DA_PREVIA, tipo: 'css', css }, '*');
    janela.postMessage({ fonte: MARCA_DA_PREVIA, tipo: 'modo', selecionando }, '*');
  }, [css, selecionando]);

  // Toda mudança de cor ou de seletor escondido vai por mensagem, sem estado
  // intermediário: guardar "a prévia está pronta" só para reenviar depois
  // custaria um render a mais a cada tecla.
  useEffect(() => {
    enviarEstado();
  }, [enviarEstado]);

  useEffect(() => {
    function aoReceber(evento: MessageEvent<unknown>) {
      const dados = evento.data;
      if (
        typeof dados === 'object' &&
        dados !== null &&
        (dados as { fonte?: unknown }).fonte === MARCA_DA_PREVIA &&
        (dados as { tipo?: unknown }).tipo === 'pronto'
      ) {
        enviarEstado();
        return;
      }
      if (
        typeof dados === 'object' &&
        dados !== null &&
        (dados as { fonte?: unknown }).fonte === MARCA_DA_PREVIA &&
        (dados as { tipo?: unknown }).tipo === 'escolhido'
      ) {
        const seletor = (dados as { seletor?: unknown }).seletor;
        if (typeof seletor === 'string' && seletor.trim() !== '') aoEscolherSeletor(seletor);
      }
    }
    window.addEventListener('message', aoReceber);
    return () => {
      window.removeEventListener('message', aoReceber);
    };
  }, [aoEscolherSeletor, enviarEstado]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-2">
        <div
          role="group"
          aria-label="Aparelho da prévia"
          className="border-input inline-flex gap-1 rounded-lg border p-1"
        >
          {(['iphone', 'android'] as const).map((opcao) => (
            <button
              key={opcao}
              type="button"
              aria-pressed={aparelho === opcao}
              onClick={() => {
                trocarAparelho(opcao);
              }}
              className={cn(
                'focus-visible:ring-ring rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
                aparelho === opcao
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60',
              )}
            >
              {opcao === 'iphone' ? 'iPhone' : 'Android'}
            </button>
          ))}
        </div>

        {identidade === undefined ? null : (
          <div
            role="group"
            aria-label="O que ver na prévia"
            className="border-input inline-flex gap-1 rounded-lg border p-1"
          >
            {(['loja', 'icone', 'abertura'] as const).map((opcao) => (
              <button
                key={opcao}
                type="button"
                aria-pressed={vista === opcao}
                disabled={selecionando && opcao !== 'loja'}
                onClick={() => {
                  setVista(opcao);
                }}
                className={cn(
                  'focus-visible:ring-ring rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50',
                  vista === opcao
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60',
                )}
              >
                {ROTULO_DA_VISTA[opcao]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        data-aparelho={aparelho}
        className={cn(
          'ring-border w-[300px] overflow-hidden shadow-xl',
          ehIphone ? 'rounded-[2.2rem] ring-8' : 'rounded-[1.4rem] ring-[6px]',
        )}
        style={{ backgroundColor: theme.background }}
      >
        {identidade !== undefined && vista === 'icone' ? (
          <div className="h-[560px]">
            <TelaInicialNaPrevia identidade={identidade} ehIphone={ehIphone} />
          </div>
        ) : null}
        {identidade !== undefined && vista === 'abertura' ? (
          <div className="h-[560px]">
            <AberturaNaPrevia identidade={identidade} />
          </div>
        ) : null}

        {/*
         * A loja fica montada nas outras vistas, só escondida: voltar para ela
         * não recarrega a página no iframe.
         */}
        <div className={vista === 'loja' ? undefined : 'hidden'}>
          {/* O topo: a ilha do iPhone, ou a câmera furada do Android. */}
          <div
            className={cn(
              'flex justify-center',
              ehIphone ? 'h-9 items-end pb-1' : 'h-7 items-center',
            )}
            style={{ backgroundColor: theme.background }}
          >
            <div
              className={ehIphone ? 'h-5 w-20 rounded-full' : 'size-3 rounded-full'}
              style={{ backgroundColor: theme.statusBar === 'light' ? '#ffffff22' : '#00000018' }}
            />
          </div>

          {aviso === '' ? null : (
            <div
              data-testid="aviso-na-previa"
              className="flex items-center gap-1 py-1.5 pr-2 pl-3"
              style={{ backgroundColor: theme.primary, color: theme.background }}
            >
              <p className="line-clamp-2 flex-1 text-center text-[11px] leading-tight font-semibold">
                {aviso}
              </p>
              <X className="size-3 shrink-0" aria-hidden />
            </div>
          )}

          <div className="relative h-[460px] w-full overflow-hidden bg-white">
            {selecionando ? (
              <p className="absolute inset-x-0 top-0 z-10 bg-blue-600 px-3 py-1.5 text-center text-[11px] font-medium text-white">
                Toque no que você quer esconder
              </p>
            ) : null}
            <iframe
              ref={iframe}
              key={src}
              src={src}
              title="Prévia da loja dentro do app"
              sandbox="allow-scripts allow-forms allow-popups"
              onLoad={enviarEstado}
              className="h-full w-full border-0"
            />
          </div>

          <div
            className={cn('flex border-t px-1 pt-2', ehIphone ? 'pb-1' : 'pb-0.5')}
            style={{ backgroundColor: theme.tabBarBg, borderColor: `${theme.tabBarInactive}55` }}
          >
            {config.tabs.map((aba) => {
              const selecionada = aba.id === ativa?.id;
              const cor = selecionada ? theme.tabBarActive : theme.tabBarInactive;
              return (
                <button
                  key={aba.id}
                  type="button"
                  onClick={() => {
                    aoTrocarAba(aba.id);
                  }}
                  aria-pressed={selecionada}
                  className="flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 py-1"
                >
                  <span className="relative">
                    <IconeDaAba nome={aba.icon} className="size-5" style={{ color: cor }} />
                    {aba.badge === 'none' ? null : (
                      /*
                       * O selo onde o app põe o número (C06b). Na prévia não há
                       * carrinho nem avisos de verdade: aparece o lugar, com um
                       * ponto, e não um número que ninguém contou.
                       */
                      <span
                        data-testid={`selo-${aba.id}`}
                        aria-hidden
                        className="absolute -top-1 -right-1.5 size-2.5 rounded-full"
                        style={{
                          backgroundColor: theme.primary,
                          boxShadow: `0 0 0 2px ${theme.tabBarBg}`,
                        }}
                      />
                    )}
                  </span>
                  <span
                    className="w-full truncate text-center text-[10px] font-medium"
                    style={{ color: cor }}
                  >
                    {aba.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Embaixo: o indicador de início do iPhone, ou a barra de gestos do Android. */}
          <div
            className={cn('flex justify-center', ehIphone ? 'pt-1 pb-2' : 'py-1.5')}
            style={{ backgroundColor: theme.tabBarBg }}
          >
            <div
              className={cn('h-1 rounded-full', ehIphone ? 'w-24' : 'w-14')}
              style={{ backgroundColor: `${theme.tabBarInactive}aa` }}
            />
          </div>
        </div>
      </div>

      <p className="text-muted-foreground max-w-[300px] text-center text-xs">
        Prévia aproximada, sem os scripts da loja. O acabamento final depende do aparelho.
      </p>
    </div>
  );
}

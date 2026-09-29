'use client';

/**
 * As abas da barra: ordem, nome, ícone e destino (C06b).
 *
 * A ordem muda arrastando a aba pelos pontinhos à esquerda — com mouse ou com
 * o dedo — ou pelas setas, que são o caminho de quem usa teclado ou leitor de
 * tela. Toda mudança de ordem é anunciada, e o foco não se perde quando a
 * seta usada deixa de valer (a aba chegou ao topo ou ao fim).
 */
import { useEffect, useRef, useState, type PointerEvent as EventoDePonteiro } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { NOMES_DE_ICONE, ROTULO_DO_ICONE, type AppConfig, type Tab } from '@storefy/config-schema';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  anuncioDaOrdem,
  deslocamentoDaVizinha,
  destinoDoArraste,
  velocidadeDaRolagem,
} from '@/lib/arrastar-abas';
import {
  MAX_ABAS,
  MIN_ABAS,
  adicionarAba,
  editarAba,
  entradaDosAjustes,
  moverAba,
  podeAdicionarAba,
  podeRemoverAba,
  removerAba,
  tiposDisponiveis,
} from '@/lib/editor-de-config';
import { cn } from '@/lib/utils';
import { IconeDaAba } from './icone-da-aba';

const ROTULO_DO_TIPO: Record<Tab['type'], string> = {
  webview: 'Página da loja',
  search: 'Busca',
  cart: 'Carrinho',
  account: 'Conta',
  notifications: 'Avisos',
};

const EXPLICACAO_DO_TIPO: Record<Tab['type'], string> = {
  webview: 'Abre um endereço da sua loja, como uma coleção.',
  search: 'Abre a busca da loja.',
  cart: 'Abre o carrinho e mostra a quantidade de itens.',
  account: 'Abre a área de conta do cliente.',
  notifications: 'Caixa de avisos nativa. Disponível quando o push estiver configurado.',
};

/** O arraste em curso, no que a tela precisa para desenhar. */
interface Arraste {
  id: string;
  origem: number;
  destino: number;
  /** Quanto a aba arrastada andou desde que foi pega: positivo desce, negativo sobe. */
  deslocamento: number;
  /** Altura da aba arrastada mais o espaço entre as abas: o quanto cada vizinha anda. */
  passo: number;
}

/** O que se mede quando a aba é pega. Fica fora do estado: muda a cada movimento. */
interface Medidas {
  id: string;
  origem: number;
  alca: HTMLElement;
  ponteiro: number;
  /** Onde o ponteiro pegou a aba, contado do topo da lista. */
  inicio: number;
  /** O centro de cada aba, contado do topo da lista, quando o arraste começou. */
  centros: number[];
  passo: number;
  /** A última altura do ponteiro na janela; a rolagem da página recalcula a partir dela. */
  y: number;
  /** A página só rola sozinha depois que a aba andou: um clique nos pontinhos não rola nada. */
  andou: boolean;
}

/** Pixels que a aba precisa andar para a página poder rolar sozinha. */
const ANDAR_PARA_ROLAR = 6;

function posicaoDoArraste(medidas: Medidas, lista: HTMLElement): Arraste {
  // Conta a partir do topo da lista, e não da janela: rolar a página no meio
  // do arraste não desencontra a aba do ponteiro.
  const deslocamento = medidas.y - lista.getBoundingClientRect().top - medidas.inicio;
  const centro = (medidas.centros[medidas.origem] ?? 0) + deslocamento;
  return {
    id: medidas.id,
    origem: medidas.origem,
    destino: destinoDoArraste(medidas.centros, centro, medidas.origem),
    deslocamento,
    passo: medidas.passo,
  };
}

export function SecaoAbas({
  config,
  aoMudar,
  somenteLeitura,
  pushConfigurado,
}: {
  config: AppConfig;
  aoMudar: (config: AppConfig) => void;
  somenteLeitura: boolean;
  /** Sem push, a aba de avisos não é oferecida: o app a esconderia. */
  pushConfigurado: boolean;
}) {
  const recursos = { push: pushConfigurado };
  const disponiveis = tiposDisponiveis(config, recursos);
  const semAjustes = entradaDosAjustes(config, recursos) === null;

  const lista = useRef<HTMLUListElement>(null);
  const medidas = useRef<Medidas | null>(null);
  const [arraste, setArraste] = useState<Arraste | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const focoPendente = useRef<string | null>(null);
  const arrastando = arraste !== null;
  // Se a lista mudar por fora no meio do arraste (o rascunho veio de outra
  // aba do navegador), a aba pega já não está onde estava: nada se desenha
  // como arraste, e soltar não move nada.
  const emCurso =
    arraste !== null && config.tabs[arraste.origem]?.id === arraste.id ? arraste : null;

  useEffect(() => {
    const id = focoPendente.current;
    if (id === null) return;
    focoPendente.current = null;
    document.getElementById(id)?.focus();
  });

  useEffect(() => {
    if (!arrastando) return;

    const acompanhar = () => {
      const atuais = medidas.current;
      const ul = lista.current;
      if (atuais !== null && ul !== null) setArraste(posicaoDoArraste(atuais, ul));
    };

    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      const atuais = medidas.current;
      medidas.current = null;
      if (atuais?.alca.hasPointerCapture(atuais.ponteiro) === true) {
        atuais.alca.releasePointerCapture(atuais.ponteiro);
      }
      setArraste(null);
    };

    let quadro = 0;
    const rolarNaBorda = () => {
      const atuais = medidas.current;
      if (atuais?.andou === true) {
        const velocidade = velocidadeDaRolagem(atuais.y, window.innerHeight);
        if (velocidade !== 0) window.scrollBy(0, velocidade);
      }
      quadro = requestAnimationFrame(rolarNaBorda);
    };
    quadro = requestAnimationFrame(rolarNaBorda);

    // Rolagem de qualquer parte da página (a roda do mouse no meio do arraste, ou
    // a rolagem da borda) move a lista sob o ponteiro parado.
    document.addEventListener('scroll', acompanhar, true);
    window.addEventListener('keydown', aoTeclar);
    return () => {
      cancelAnimationFrame(quadro);
      document.removeEventListener('scroll', acompanhar, true);
      window.removeEventListener('keydown', aoTeclar);
    };
  }, [arrastando]);

  function pegar(evento: EventoDePonteiro<HTMLDivElement>, indice: number, id: string) {
    if (somenteLeitura || medidas.current !== null) return;
    if (!evento.isPrimary || evento.button !== 0) return;
    const ul = lista.current;
    if (ul === null) return;
    const linhas = Array.from(ul.children, (filho) => filho.getBoundingClientRect());
    const pega = linhas[indice];
    if (pega === undefined) return;

    // Sem isso o navegador começa a selecionar texto em vez de arrastar.
    evento.preventDefault();
    evento.currentTarget.setPointerCapture(evento.pointerId);
    const topo = ul.getBoundingClientRect().top;
    const [primeira, segunda] = linhas;
    const espaco =
      primeira !== undefined && segunda !== undefined ? segunda.top - primeira.bottom : 0;
    const novas: Medidas = {
      id,
      origem: indice,
      alca: evento.currentTarget,
      ponteiro: evento.pointerId,
      inicio: evento.clientY - topo,
      centros: linhas.map((linha) => linha.top - topo + linha.height / 2),
      passo: pega.height + espaco,
      y: evento.clientY,
      andou: false,
    };
    medidas.current = novas;
    setArraste(posicaoDoArraste(novas, ul));
  }

  function arrastar(evento: EventoDePonteiro<HTMLDivElement>) {
    const atuais = medidas.current;
    const ul = lista.current;
    if (atuais === null || ul === null || evento.pointerId !== atuais.ponteiro) return;
    atuais.y = evento.clientY;
    const proxima = posicaoDoArraste(atuais, ul);
    if (Math.abs(proxima.deslocamento) >= ANDAR_PARA_ROLAR) atuais.andou = true;
    setArraste(proxima);
  }

  function soltar(evento: EventoDePonteiro<HTMLDivElement>) {
    const atuais = medidas.current;
    if (atuais?.ponteiro !== evento.pointerId) return;
    medidas.current = null;
    setArraste(null);
    const ul = lista.current;
    if (ul === null) return;
    atuais.y = evento.clientY;
    const { destino } = posicaoDoArraste(atuais, ul);
    const aba = config.tabs[atuais.origem];
    if (destino === atuais.origem || aba?.id !== atuais.id) return;
    aoMudar(moverAba(config, atuais.origem, destino));
    setAnuncio(anuncioDaOrdem(aba.label, destino, config.tabs.length));
  }

  /** O navegador tirou o ponteiro (ligação, gesto do sistema): o arraste acaba sem mudar nada. */
  function largar(evento: EventoDePonteiro<HTMLDivElement>) {
    const atuais = medidas.current;
    if (atuais?.ponteiro !== evento.pointerId) return;
    medidas.current = null;
    setArraste(null);
  }

  function moverPelaSeta(aba: Tab, de: number, para: number) {
    aoMudar(moverAba(config, de, para));
    setAnuncio(anuncioDaOrdem(aba.label, para, config.tabs.length));
    // Reordenar pode tirar a aba do lugar na página, e com ela o foco: ele volta
    // para a seta usada. No topo "para cima" se desliga, e no fim "para baixo" —
    // aí o foco vai para a outra seta da mesma aba, e não para o começo da página.
    const seta = para === 0 ? 'descer' : para === config.tabs.length - 1 ? 'subir' : null;
    focoPendente.current = `aba-${aba.id}-${seta ?? (para < de ? 'subir' : 'descer')}`;
  }

  function remover(aba: Tab, indice: number) {
    const proxima = removerAba(config, aba.id);
    aoMudar(proxima);
    const nome = aba.label.trim() === '' ? 'A aba sem nome' : `“${aba.label.trim()}”`;
    setAnuncio(`${nome} saiu da barra.`);
    // O foco vai para a aba que ficou no lugar (ou a de cima, se era a última).
    const vizinha = proxima.tabs[Math.min(indice, proxima.tabs.length - 1)];
    if (vizinha !== undefined) focoPendente.current = `aba-${vizinha.id}-nome`;
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        A barra cabe de {MIN_ABAS} a {MAX_ABAS} abas, na ordem em que aparecem aqui.
        {somenteLeitura
          ? null
          : ' Para mudar a ordem, arraste a aba pelos pontinhos à esquerda ou use as setas.'}
      </p>

      {semAjustes ? (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>Sem a aba Conta, o cliente não acha os ajustes do app</AlertTitle>
          <AlertDescription>
            É nos Ajustes do app que o cliente desliga as notificações e lê a política de
            privacidade, e a Apple exige esse caminho dentro do app. Ele fica no topo da aba Conta
            {pushConfigurado ? ' (ou na engrenagem da aba Avisos)' : ''}. Sem uma delas, o envio
            para as lojas fica travado.
          </AlertDescription>
        </Alert>
      ) : null}

      <p role="status" data-testid="anuncio-das-abas" className="sr-only">
        {anuncio}
      </p>

      <ul ref={lista} className="space-y-3">
        {config.tabs.map((aba, indice) => {
          const pega = emCurso?.id === aba.id;
          const deslocamento =
            emCurso === null
              ? 0
              : pega
                ? emCurso.deslocamento
                : deslocamentoDaVizinha(indice, emCurso.origem, emCurso.destino, emCurso.passo);
          return (
            <li
              key={aba.id}
              data-arrastada={pega ? 'sim' : undefined}
              style={
                deslocamento === 0
                  ? undefined
                  : { transform: `translateY(${String(deslocamento)}px)` }
              }
              className={cn(
                'bg-card rounded-xl border p-4',
                // As vizinhas deslizam para abrir espaço; ao soltar, tudo se
                // acomoda de uma vez, sem animar de volta.
                emCurso !== null &&
                  !pega &&
                  'transition-transform duration-150 ease-out motion-reduce:transition-none',
                pega && 'ring-primary/40 relative z-10 shadow-lg ring-2',
              )}
            >
              <div className="flex items-start gap-3">
                {somenteLeitura ? null : (
                  <div
                    aria-hidden
                    data-testid="alca-da-aba"
                    title="Arraste para mudar a ordem"
                    className={cn(
                      'text-muted-foreground hover:text-foreground -mr-1 -ml-2 flex h-10 w-6 shrink-0 touch-none items-center justify-center rounded-md select-none',
                      pega ? 'cursor-grabbing' : 'cursor-grab',
                    )}
                    onPointerDown={(evento) => {
                      pegar(evento, indice, aba.id);
                    }}
                    onPointerMove={arrastar}
                    onPointerUp={soltar}
                    onPointerCancel={largar}
                    onLostPointerCapture={largar}
                  >
                    <GripVertical className="size-4" />
                  </div>
                )}

                <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
                  <IconeDaAba nome={aba.icon} className="size-5" />
                </div>

                <div className="grid flex-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`aba-${aba.id}-nome`}>Nome na barra</Label>
                    <Input
                      id={`aba-${aba.id}-nome`}
                      value={aba.label}
                      maxLength={12}
                      disabled={somenteLeitura}
                      onChange={(evento) => {
                        aoMudar(editarAba(config, aba.id, { label: evento.target.value }));
                      }}
                    />
                    <p className="text-muted-foreground text-xs">
                      {aba.label.length}/12 caracteres
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`aba-${aba.id}-icone`}>Ícone</Label>
                    <Select
                      id={`aba-${aba.id}-icone`}
                      value={aba.icon}
                      disabled={somenteLeitura}
                      onChange={(evento) => {
                        aoMudar(editarAba(config, aba.id, { icon: evento.target.value }));
                      }}
                    >
                      {NOMES_DE_ICONE.map((nome) => (
                        <option key={nome} value={nome}>
                          {ROTULO_DO_ICONE[nome]}
                        </option>
                      ))}
                    </Select>
                  </div>

                  {aba.type === 'webview' ? (
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor={`aba-${aba.id}-url`}>Endereço na loja</Label>
                      <Input
                        id={`aba-${aba.id}-url`}
                        value={aba.url ?? ''}
                        placeholder="/collections/novidades"
                        spellCheck={false}
                        disabled={somenteLeitura}
                        onChange={(evento) => {
                          aoMudar(editarAba(config, aba.id, { url: evento.target.value }));
                        }}
                      />
                      <p className="text-muted-foreground text-xs">
                        Caminho dentro da sua loja, começando com “/”.
                      </p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground self-center text-xs sm:col-span-2">
                      {EXPLICACAO_DO_TIPO[aba.type]}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    id={`aba-${aba.id}-subir`}
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Mover ${aba.label} para cima`}
                    disabled={somenteLeitura || indice === 0}
                    onClick={() => {
                      moverPelaSeta(aba, indice, indice - 1);
                    }}
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button
                    id={`aba-${aba.id}-descer`}
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Mover ${aba.label} para baixo`}
                    disabled={somenteLeitura || indice === config.tabs.length - 1}
                    onClick={() => {
                      moverPelaSeta(aba, indice, indice + 1);
                    }}
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remover ${aba.label}`}
                    disabled={somenteLeitura || !podeRemoverAba(config)}
                    onClick={() => {
                      remover(aba, indice);
                    }}
                  >
                    <Trash2 className="text-destructive size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {somenteLeitura ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {podeAdicionarAba(config, recursos) ? (
            disponiveis.map((tipo) => (
              <Button
                key={tipo}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  aoMudar(adicionarAba(config, tipo, recursos));
                }}
              >
                <Plus className="size-4" aria-hidden />
                {ROTULO_DO_TIPO[tipo]}
              </Button>
            ))
          ) : (
            <p className="text-muted-foreground text-sm">
              {config.tabs.length >= MAX_ABAS
                ? `A barra já está com as ${String(MAX_ABAS)} abas que cabem.`
                : 'Todos os tipos de aba já estão na barra.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

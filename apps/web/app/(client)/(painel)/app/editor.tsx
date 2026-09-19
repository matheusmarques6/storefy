'use client';

/**
 * O editor do app (C06).
 *
 * Guarda a config inteira em estado e compara com a que veio do servidor para
 * saber se há mudança não salva. A barra de salvar só aparece quando há — uma
 * barra permanente vira parte do cenário e some da atenção de quem edita.
 *
 * Sair da página com alteração pendente avisa. O lojista pode passar meia hora
 * ajustando cor e perder tudo num clique no menu.
 */
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { AlertTriangle, Check, Eye, MousePointerClick, Rocket, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { AppConfig } from '@storefy/config-schema';
import type { VersaoDoHistorico, VersaoPublicada } from '@/lib/configs-servidor';
import { editarWebview, validarConfig, type Problema } from '@/lib/editor-de-config';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { publicarConfig, salvarConfig } from './acoes';
import { Previa } from './previa';
import { SecaoAbas } from './secao-abas';
import { SecaoAparencia } from './secao-aparencia';
import { SecaoLoja } from './secao-loja';
import { SecaoRecursos } from './secao-recursos';
import { SecaoVersoes } from './secao-versoes';

type Secao = 'aparencia' | 'abas' | 'loja' | 'recursos' | 'versoes';

const SECOES: { id: Secao; rotulo: string; descricao: string }[] = [
  { id: 'aparencia', rotulo: 'Aparência', descricao: 'Cores do app e barra de status.' },
  { id: 'abas', rotulo: 'Abas', descricao: 'O que aparece na barra de baixo, e em que ordem.' },
  { id: 'loja', rotulo: 'Loja', descricao: 'O que esconder do site dentro do app.' },
  { id: 'recursos', rotulo: 'Recursos', descricao: 'Boas-vindas, banner e notificações.' },
  { id: 'versoes', rotulo: 'Versões', descricao: 'O que já foi publicado, e como voltar atrás.' },
];

interface Props {
  storeId: string;
  configInicialDoServidor: AppConfig;
  versao: number;
  publicada: VersaoPublicada | null;
  historico: VersaoDoHistorico[];
  somenteLeitura: boolean;
  pushConfigurado: boolean;
}

export function Editor({
  storeId,
  configInicialDoServidor,
  versao,
  publicada,
  historico,
  somenteLeitura,
  pushConfigurado,
}: Props) {
  const [config, setConfig] = useState(configInicialDoServidor);
  const [salvo, setSalvo] = useState(configInicialDoServidor);
  const [secao, setSecao] = useState<Secao>('aparencia');
  const [abaEscolhidaNaPrevia, setAbaDaPrevia] = useState<string | null>(null);
  const [problemasDoServidor, setProblemasDoServidor] = useState<Problema[]>([]);
  const [confirmandoPublicacao, setConfirmandoPublicacao] = useState(false);
  const [selecionando, setSelecionando] = useState(false);
  const [salvando, iniciarSalvar] = useTransition();
  const [publicando, iniciarPublicar] = useTransition();

  const mudou = useMemo(() => JSON.stringify(config) !== JSON.stringify(salvo), [config, salvo]);
  const problemas = useMemo(() => validarConfig(config), [config]);
  const todosOsProblemas = problemas.length > 0 ? problemas : problemasDoServidor;

  /*
   * A config do servidor muda quando outra aba do navegador publica ou
   * restaura. O ajuste é feito DURANTE o render, comparando com a anterior, e
   * não num efeito: um `setState` dentro de efeito desenha a tela uma vez com o
   * valor velho antes de corrigir, e num editor isso aparece como piscada.
   */
  const [ultimaDoServidor, setUltimaDoServidor] = useState(configInicialDoServidor);
  if (ultimaDoServidor !== configInicialDoServidor) {
    setUltimaDoServidor(configInicialDoServidor);
    setConfig(configInicialDoServidor);
    setSalvo(configInicialDoServidor);
  }

  /*
   * A aba destacada é DERIVADA, e não guardada: a aba escolhida pode ter sido
   * removida na edição, e guardar o id exigiria um efeito para consertar.
   */
  const abaDaPrevia =
    config.tabs.find((aba) => aba.id === abaEscolhidaNaPrevia)?.id ?? config.tabs[0]?.id ?? '';

  useEffect(() => {
    if (!mudou) return;
    function avisar(evento: BeforeUnloadEvent) {
      evento.preventDefault();
    }
    window.addEventListener('beforeunload', avisar);
    return () => {
      window.removeEventListener('beforeunload', avisar);
    };
  }, [mudou]);

  const salvar = useCallback(() => {
    iniciarSalvar(() => {
      void salvarConfig(storeId, config).then((estado) => {
        setProblemasDoServidor(estado.problemas ?? []);
        if (estado.ok === true) {
          setSalvo(config);
          toast.success(estado.mensagem ?? 'Rascunho salvo.');
        } else {
          toast.error(estado.mensagem ?? 'Não foi possível salvar.');
        }
      });
    });
  }, [config, storeId]);

  function publicar() {
    iniciarPublicar(() => {
      void publicarConfig(storeId).then((estado) => {
        setConfirmandoPublicacao(false);
        setProblemasDoServidor(estado.problemas ?? []);
        if (estado.ok === true) toast.success(estado.mensagem ?? 'Publicado.');
        else toast.error(estado.mensagem ?? 'Não foi possível publicar.');
      });
    });
  }

  /*
   * O caminho da prévia segue a aba destacada. Só ele recarrega o iframe — cor
   * e seletor escondido viajam por `postMessage`, sem recarregar a loja.
   */
  const caminhoDaPrevia = useMemo(() => {
    const aba = config.tabs.find((item) => item.id === abaDaPrevia);
    if (aba === undefined) return '/';
    if (aba.type === 'webview') return aba.url ?? '/';
    if (aba.type === 'cart') return '/cart';
    if (aba.type === 'account') return '/account';
    if (aba.type === 'search') return '/search';
    return '/';
  }, [abaDaPrevia, config.tabs]);

  /**
   * O lojista clicou em algo na prévia para esconder.
   *
   * Entra na lista sem repetir, e a seção pula para "Loja": ver o item
   * aparecer na lista é o que confirma que o clique funcionou.
   */
  const aoEscolherSeletor = useCallback((seletor: string) => {
    setConfig((atual) => {
      const limpo = seletor.trim();
      if (limpo === '' || atual.webview.hideSelectors.includes(limpo)) return atual;
      return editarWebview(atual, {
        hideSelectors: [...atual.webview.hideSelectors, limpo],
      });
    });
    setSecao('loja');
    toast.success(`Escondendo "${seletor}".`);
  }, []);

  const secaoAtual = SECOES.find((item) => item.id === secao) ?? SECOES[0];

  return (
    <div className="space-y-6 pb-28">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Editor do app</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Ajuste como o seu app fica, veja na prévia e publique quando estiver do seu gosto.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Rascunho v{versao}</Badge>
          {publicada === null ? (
            <Badge variant="outline">Nunca publicado</Badge>
          ) : (
            <Badge>No ar: v{publicada.version}</Badge>
          )}
        </div>
      </div>

      {somenteLeitura ? (
        <Alert>
          <Eye className="size-4" aria-hidden />
          <AlertTitle>Somente leitura</AlertTitle>
          <AlertDescription>
            Seu papel nesta empresa permite ver o editor, mas não alterar. Peça a um proprietário ou
            administrador para publicar as mudanças.
          </AlertDescription>
        </Alert>
      ) : null}

      {todosOsProblemas.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>
            {todosOsProblemas.length === 1
              ? 'Um ponto para resolver antes de publicar'
              : `${String(todosOsProblemas.length)} pontos para resolver antes de publicar`}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {todosOsProblemas.map((problema, indice) => (
                <li key={`${problema.secao}:${String(indice)}`}>
                  {problema.mensagem}{' '}
                  <button
                    type="button"
                    className="underline underline-offset-4"
                    onClick={() => {
                      setSecao(problema.secao);
                    }}
                  >
                    Ir para {SECOES.find((s) => s.id === problema.secao)?.rotulo ?? 'a seção'}
                  </button>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <nav aria-label="Seções do editor" className="flex flex-wrap gap-1">
            {SECOES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={item.id === secao ? 'page' : undefined}
                onClick={() => {
                  setSecao(item.id);
                }}
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  item.id === secao
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60',
                )}
              >
                {item.rotulo}
              </button>
            ))}
          </nav>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{secaoAtual?.rotulo}</CardTitle>
              <CardDescription>{secaoAtual?.descricao}</CardDescription>
            </CardHeader>
            <CardContent>
              {secao === 'aparencia' ? (
                <SecaoAparencia
                  config={config}
                  aoMudar={setConfig}
                  somenteLeitura={somenteLeitura}
                />
              ) : null}
              {secao === 'abas' ? (
                <SecaoAbas
                  config={config}
                  aoMudar={setConfig}
                  somenteLeitura={somenteLeitura}
                  pushConfigurado={pushConfigurado}
                />
              ) : null}
              {secao === 'loja' ? (
                <SecaoLoja config={config} aoMudar={setConfig} somenteLeitura={somenteLeitura} />
              ) : null}
              {secao === 'recursos' ? (
                <SecaoRecursos
                  config={config}
                  aoMudar={setConfig}
                  somenteLeitura={somenteLeitura}
                  pushConfigurado={pushConfigurado}
                />
              ) : null}
              {secao === 'versoes' ? (
                <SecaoVersoes
                  storeId={storeId}
                  versoes={historico}
                  somenteLeitura={somenteLeitura}
                />
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <Previa
            config={config}
            abaAtiva={abaDaPrevia}
            aoTrocarAba={setAbaDaPrevia}
            lojaId={storeId}
            caminho={caminhoDaPrevia}
            selecionando={selecionando}
            aoEscolherSeletor={aoEscolherSeletor}
          />

          {somenteLeitura ? null : (
            <Button
              type="button"
              variant={selecionando ? 'default' : 'outline'}
              className="w-full"
              onClick={() => {
                setSelecionando((antes) => !antes);
              }}
            >
              <MousePointerClick className="size-4" aria-hidden />
              {selecionando ? 'Parar de escolher' : 'Escolher o que esconder'}
            </Button>
          )}
        </div>
      </div>

      {/* Barra de salvar: só existe quando há o que salvar. */}
      {mudou && !somenteLeitura ? (
        <div className="bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t p-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <p className="text-sm">
              <span className="font-medium">Alterações não salvas.</span>{' '}
              <span className="text-muted-foreground hidden sm:inline">
                Elas ainda não estão no app dos seus clientes.
              </span>
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={salvando}
                onClick={() => {
                  setConfig(salvo);
                  setProblemasDoServidor([]);
                }}
              >
                Descartar
              </Button>
              <Button type="button" onClick={salvar} disabled={salvando || problemas.length > 0}>
                <Save className="size-4" aria-hidden />
                {salvando ? 'Salvando…' : 'Salvar rascunho'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {!mudou && !somenteLeitura ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <div className="flex items-center gap-2 text-sm">
            <Check className="size-4 text-emerald-600" aria-hidden />
            <span className="text-muted-foreground">
              Rascunho salvo.{' '}
              {publicada === null
                ? 'Publique para o app começar a usar esta configuração.'
                : `O app está usando a versão ${String(publicada.version)}.`}
            </span>
          </div>
          <Button
            type="button"
            disabled={publicando || problemas.length > 0}
            onClick={() => {
              setConfirmandoPublicacao(true);
            }}
          >
            <Rocket className="size-4" aria-hidden />
            {publicando ? 'Publicando…' : 'Publicar'}
          </Button>
        </div>
      ) : null}

      <AlertDialog open={confirmandoPublicacao} onOpenChange={setConfirmandoPublicacao}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publicar a versão {versao}?</AlertDialogTitle>
            <AlertDialogDescription>
              O app de todos os seus clientes passa a usar esta configuração em até um minuto. A
              versão que está no ar hoje continua no histórico, e dá para voltar a ela.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={publicando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={publicando}
              onClick={(evento) => {
                evento.preventDefault();
                publicar();
              }}
            >
              {publicando ? 'Publicando…' : 'Publicar agora'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

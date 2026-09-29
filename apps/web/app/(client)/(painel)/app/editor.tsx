'use client';

/**
 * O editor do app (C06).
 *
 * Guarda a config inteira em estado e a grava SOZINHA no rascunho, um instante
 * depois de a pessoa parar de mexer (seção 10 do plano) — ninguém perde meia
 * hora de ajuste por esquecer um botão. As gravações vão em fila: duas
 * seguidas não chegam fora de ordem, e o que fica no banco é sempre a última.
 * Config com ponto a corrigir não é gravada: o rascunho continua sendo algo
 * que pode ir ao ar.
 *
 * A barra de baixo diz como está o rascunho e quantas mudanças vão ao ar com
 * "Publicar alterações". Fechar ou recarregar a aba com gravação pendente
 * avisa; sair pelo menu do painel grava na hora o que estava esperando.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { AlertTriangle, Eye, MousePointerClick } from 'lucide-react';
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
import { Previa, caminhoDaPrevia } from './previa';
import { PreviaNoCelular } from './previa-no-celular';
import { BarraDePublicacao, type SituacaoDoRascunho } from './barra-de-publicacao';
import { SecaoAbas } from './secao-abas';
import { SecaoAparencia } from './secao-aparencia';
import { SecaoLoja } from './secao-loja';
import type { Preset } from '@/lib/presets';
import type { OndeBaixarAPrevia } from '@/lib/configuracoes-da-plataforma';
import { conteudoDaConfig, mudancasPendentes } from '@/lib/mudancas-pendentes';
import { SecaoRecursos } from './secao-recursos';
import { SecaoVersoes } from './secao-versoes';

/** Quanto esperar depois da última mudança para gravar o rascunho. */
const ESPERA_PARA_GRAVAR_MS = 1000;

type Secao = 'aparencia' | 'abas' | 'loja' | 'recursos' | 'versoes';

const SECOES: { id: Secao; rotulo: string; descricao: string }[] = [
  { id: 'aparencia', rotulo: 'Aparência', descricao: 'Cores do app e barra de status.' },
  { id: 'abas', rotulo: 'Abas', descricao: 'O que aparece na barra de baixo, e em que ordem.' },
  { id: 'loja', rotulo: 'Loja', descricao: 'O que esconder do site dentro do app.' },
  {
    id: 'recursos',
    rotulo: 'Recursos',
    descricao: 'Boas-vindas, banner, aviso no topo, notificações e Face ID.',
  },
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
  /** O último número de build aprovado nas duas lojas (atualização obrigatória). */
  numeroExigivel: number | null;
  /** Presets de tema curados pela equipe (A10). Vazio some da tela. */
  presets: Preset[];
  /** O fuso da loja, para as datas do histórico de versões. */
  fuso: string;
  /** Links assinados das imagens atuais. O bucket é privado. */
  urlDoIcone: string | null;
  urlDaSplash: string | null;
  /** Onde baixar o Storefy Preview (A13). */
  ondeBaixarAPrevia: OndeBaixarAPrevia;
}

export function Editor({
  storeId,
  configInicialDoServidor,
  versao,
  publicada,
  historico,
  somenteLeitura,
  pushConfigurado,
  numeroExigivel,
  presets,
  fuso,
  urlDoIcone,
  urlDaSplash,
  ondeBaixarAPrevia,
}: Props) {
  const [config, setConfig] = useState(configInicialDoServidor);
  const [salvo, setSalvo] = useState(configInicialDoServidor);
  const [secao, setSecao] = useState<Secao>('aparencia');
  const [abaEscolhidaNaPrevia, setAbaDaPrevia] = useState<string | null>(null);
  const [problemasDoServidor, setProblemasDoServidor] = useState<Problema[]>([]);
  const [confirmandoPublicacao, setConfirmandoPublicacao] = useState(false);
  const [selecionando, setSelecionando] = useState(false);
  const [publicando, iniciarPublicar] = useTransition();
  /** Só o que a gravação diz: salvo, salvando ou erro. O resto é derivado. */
  const [gravacao, setGravacao] = useState<SituacaoDoRascunho>({ tipo: 'salvo', em: null });
  /**
   * O conteúdo de cada gravação a caminho, para reconhecer a volta dela. É
   * estado, e não ref, porque é lido durante o render.
   */
  const [emVoo, setEmVoo] = useState<string[]>([]);
  /**
   * As gravações vão em fila, e `pendente` é a config esperando o fim da
   * pausa — a que sai na hora se a pessoa deixar a tela. Um objeto só, que
   * nunca é trocado: os efeitos o leem na montagem e o usam na desmontagem.
   */
  const gravacoes = useRef<{ fila: Promise<void>; pendente: AppConfig | null }>({
    fila: Promise.resolve(),
    pendente: null,
  });

  const mudou = useMemo(() => JSON.stringify(config) !== JSON.stringify(salvo), [config, salvo]);
  const problemas = useMemo(() => validarConfig(config), [config]);
  const todosOsProblemas = problemas.length > 0 ? problemas : problemasDoServidor;

  const situacao: SituacaoDoRascunho =
    gravacao.tipo === 'salvando' || gravacao.tipo === 'erro'
      ? gravacao
      : !mudou
        ? gravacao
        : problemas.length > 0
          ? { tipo: 'com-problemas' }
          : { tipo: 'pendente' };

  const mudancas = publicada?.config == null ? null : mudancasPendentes(config, publicada.config);

  /*
   * A config do servidor chega de novo depois de cada ação que atualiza a
   * página — inclusive a própria gravação, que devolve o que acabou de gravar.
   * Adotá-la sempre apagava o que a pessoa digitou enquanto a gravação ia e
   * voltava, e a barra ainda dizia "salvo". Por isso ela só substitui a tela
   * quando traz OUTRO conteúdo, como uma versão restaurada; a volta de uma
   * gravação, ou a publicação do que já estava salvo, passam direto.
   *
   * O ajuste é feito DURANTE o render, comparando com a anterior, e não num
   * efeito: um `setState` dentro de efeito desenha a tela uma vez com o valor
   * velho antes de corrigir, e num editor isso aparece como piscada.
   */
  const [ultimaDoServidor, setUltimaDoServidor] = useState(configInicialDoServidor);
  if (ultimaDoServidor !== configInicialDoServidor) {
    setUltimaDoServidor(configInicialDoServidor);
    const doServidor = conteudoDaConfig(configInicialDoServidor);
    if (doServidor !== conteudoDaConfig(salvo) && !emVoo.includes(doServidor)) {
      setConfig(configInicialDoServidor);
      setSalvo(configInicialDoServidor);
    }
  }

  /*
   * A aba destacada é DERIVADA, e não guardada: a aba escolhida pode ter sido
   * removida na edição, e guardar o id exigiria um efeito para consertar.
   */
  const abaDaPrevia =
    config.tabs.find((aba) => aba.id === abaEscolhidaNaPrevia)?.id ?? config.tabs[0]?.id ?? '';

  const pendente = mudou || gravacao.tipo === 'salvando';
  useEffect(() => {
    if (!pendente) return;
    function avisar(evento: BeforeUnloadEvent) {
      evento.preventDefault();
    }
    window.addEventListener('beforeunload', avisar);
    return () => {
      window.removeEventListener('beforeunload', avisar);
    };
  }, [pendente]);

  /** Grava ESTA config, depois de qualquer gravação que já esteja a caminho. */
  const gravar = useCallback(
    (alvo: AppConfig) => {
      const conteudo = conteudoDaConfig(alvo);
      setGravacao({ tipo: 'salvando' });
      setEmVoo((lista) => [...lista, conteudo]);
      const estado = gravacoes.current;
      estado.fila = estado.fila.then(async () => {
        try {
          const estado = await salvarConfig(storeId, alvo);
          setProblemasDoServidor(estado.problemas ?? []);
          if (estado.ok === true) {
            setSalvo(alvo);
            setGravacao({ tipo: 'salvo', em: new Date() });
          } else {
            setGravacao({
              tipo: 'erro',
              mensagem: estado.mensagem ?? 'Não foi possível salvar o rascunho.',
            });
          }
        } catch {
          // A ação nem chegou ao servidor: a rede caiu no meio do caminho.
          setGravacao({
            tipo: 'erro',
            mensagem: 'Sem conexão com a Storefy: o rascunho não foi salvo.',
          });
        } finally {
          setEmVoo((lista) => {
            const indice = lista.indexOf(conteudo);
            return indice === -1 ? lista : [...lista.slice(0, indice), ...lista.slice(indice + 1)];
          });
        }
      });
    },
    [storeId],
  );

  // Um instante depois de a pessoa parar de mexer, grava. Com ponto a
  // corrigir, espera: gravar poria no rascunho algo que não pode ir ao ar.
  useEffect(() => {
    const estado = gravacoes.current;
    if (somenteLeitura || !mudou || problemas.length > 0) {
      estado.pendente = null;
      return;
    }
    estado.pendente = config;
    const espera = window.setTimeout(() => {
      estado.pendente = null;
      gravar(config);
    }, ESPERA_PARA_GRAVAR_MS);
    return () => {
      window.clearTimeout(espera);
    };
  }, [config, gravar, mudou, problemas.length, somenteLeitura]);

  /*
   * Sair da tela no meio da pausa não pode perder a mudança. O `beforeunload`
   * só pega fechar e recarregar a aba; ir para outra tela pelo menu do painel
   * desmonta o editor sem passar por ele. Então a gravação que esperava sai
   * na hora, na mesma fila — e, como a tela já foi embora, um erro vira aviso.
   */
  useEffect(() => {
    const estado = gravacoes.current;
    return () => {
      const alvo = estado.pendente;
      if (alvo === null) return;
      estado.pendente = null;
      estado.fila = estado.fila.then(async () => {
        const falha = 'A última mudança no app não foi salva. Volte ao editor e confira.';
        try {
          const resultado = await salvarConfig(storeId, alvo);
          if (resultado.ok !== true) toast.error(resultado.mensagem ?? falha);
        } catch {
          toast.error(falha);
        }
      });
    };
  }, [storeId]);

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
  const caminhoNaPrevia = useMemo(
    () => caminhoDaPrevia(config, abaDaPrevia),
    [abaDaPrevia, config],
  );

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
                  storeId={storeId}
                  urlDoIcone={urlDoIcone}
                  urlDaSplash={urlDaSplash}
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
                <SecaoLoja
                  config={config}
                  aoMudar={setConfig}
                  somenteLeitura={somenteLeitura}
                  presets={presets}
                />
              ) : null}
              {secao === 'recursos' ? (
                <SecaoRecursos
                  config={config}
                  aoMudar={setConfig}
                  somenteLeitura={somenteLeitura}
                  pushConfigurado={pushConfigurado}
                  numeroExigivel={numeroExigivel}
                />
              ) : null}
              {secao === 'versoes' ? (
                <SecaoVersoes
                  storeId={storeId}
                  versoes={historico}
                  somenteLeitura={somenteLeitura}
                  fuso={fuso}
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
            caminho={caminhoNaPrevia}
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

          <PreviaNoCelular
            storeId={storeId}
            somenteLeitura={somenteLeitura}
            ondeBaixar={ondeBaixarAPrevia}
          />
        </div>
      </div>

      {somenteLeitura ? null : (
        <BarraDePublicacao
          situacao={situacao}
          versaoNoAr={publicada?.version ?? null}
          mudancas={mudancas}
          publicando={publicando}
          fuso={fuso}
          aoTentarDeNovo={() => {
            gravar(config);
          }}
          aoPublicar={() => {
            setConfirmandoPublicacao(true);
          }}
        />
      )}

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

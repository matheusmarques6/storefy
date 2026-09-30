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
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Eye,
  History,
  MousePointerClick,
  Palette,
  PanelBottom,
  Sparkles,
  Store,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AppConfig } from '@storefy/config-schema';
import type { VersaoDoHistorico, VersaoPublicada } from '@/lib/configs-servidor';
import { editarWebview, validarConfig, type Problema } from '@/lib/editor-de-config';
import { fundoDoApp } from '@/lib/fundo-do-app';
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
import { publicarConfig, restaurarVersao, salvarConfig, type EstadoDoEditor } from './acoes';
import { Previa, caminhoDaPrevia } from './previa';
import { PreviaNoCelular } from './previa-no-celular';
import { BarraDePublicacao, type SituacaoDoRascunho } from './barra-de-publicacao';
import { SecaoAbas } from './secao-abas';
import { SecaoAparencia } from './secao-aparencia';
import { SecaoLoja } from './secao-loja';
import type { Preset } from '@/lib/presets';
import type { OndeBaixarAPrevia } from '@/lib/configuracoes-da-plataforma';
import { conteudoDaConfig, impressaoDaConfig, mudancasPendentes } from '@/lib/mudancas-pendentes';
import { diferencasDaConfig } from '@/lib/diferencas-da-config';
import { ListaDeDiferencas } from './lista-de-diferencas';
import { SecaoRecursos } from './secao-recursos';
import { SecaoVersoes } from './secao-versoes';

/** Quanto esperar depois da última mudança para gravar o rascunho. */
const ESPERA_PARA_GRAVAR_MS = 1000;

type Secao = 'aparencia' | 'abas' | 'loja' | 'recursos' | 'versoes';

const SECOES: { id: Secao; rotulo: string; descricao: string; icone: LucideIcon }[] = [
  {
    id: 'aparencia',
    rotulo: 'Aparência',
    descricao: 'Nome, ícone, tela de abertura, cores e barra de status.',
    icone: Palette,
  },
  {
    id: 'abas',
    rotulo: 'Abas',
    descricao: 'O que aparece na barra de baixo, e em que ordem.',
    icone: PanelBottom,
  },
  { id: 'loja', rotulo: 'Loja', descricao: 'O que esconder do site dentro do app.', icone: Store },
  {
    id: 'recursos',
    rotulo: 'Recursos',
    descricao: 'Boas-vindas, banner, aviso no topo, notificações e Face ID.',
    icone: Sparkles,
  },
  {
    id: 'versoes',
    rotulo: 'Versões',
    descricao: 'O que já foi publicado: comparar com o rascunho e voltar atrás.',
    icone: History,
  },
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
  /** O tema da Shopify que a loja usa, lido da página (A10). */
  temaDaLoja: string | null;
  /** Os presets são de temas da Shopify: só nela dá para ler o tema. */
  lojaNaShopify: boolean;
  /** O fuso da loja, para as datas do histórico de versões. */
  fuso: string;
  /** O nome embaixo do ícone (C06a). Fora da config: muda no próximo envio às lojas. */
  nomeDoApp: string;
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
  temaDaLoja,
  lojaNaShopify,
  fuso,
  nomeDoApp,
  urlDoIcone,
  urlDaSplash,
  ondeBaixarAPrevia,
}: Props) {
  const [config, setConfig] = useState(configInicialDoServidor);
  const [salvo, setSalvo] = useState(configInicialDoServidor);
  const [secao, setSecao] = useState<Secao>('aparencia');
  const [abaEscolhidaNaPrevia, setAbaDaPrevia] = useState<string | null>(null);
  // A tela de boas-vindas em edição, para a prévia ir até ela (C06d).
  const [slideEmFoco, setSlideEmFoco] = useState<{ indice: number } | null>(null);
  const [problemasDoServidor, setProblemasDoServidor] = useState<Problema[]>([]);
  const [confirmandoPublicacao, setConfirmandoPublicacao] = useState(false);
  const [confirmandoDesfazer, setConfirmandoDesfazer] = useState(false);
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
  const gravacoes = useRef<{
    fila: Promise<void>;
    pendente: AppConfig | null;
    /**
     * A impressão do que está no banco, pelo que esta tela sabe (`salvo`):
     * cada gravação vai "em cima dela", e o servidor recusa se o rascunho de
     * lá já tiver outro conteúdo. Lida quando a gravação SAI da fila — duas
     * seguidas desta mesma aba não brigam uma com a outra. Preenchida pelo
     * efeito logo abaixo, na montagem, antes de qualquer gravação.
     */
    base: string;
    /** O rascunho mudou em outro lugar: nada é gravado até a pessoa decidir. */
    conflito: boolean;
  }>({
    fila: Promise.resolve(),
    pendente: null,
    base: '',
    conflito: false,
  });

  /*
   * `salvo` muda quando uma gravação volta (e a fila já atualizou a base) e
   * quando a tela adota a config do servidor, como numa versão restaurada.
   * Num efeito, e não antes: um salvamento que já esperava a pausa e saísse
   * entre a troca e este efeito vai com a base antiga — e volta como conflito,
   * em vez de gravar a config velha por cima da restaurada.
   */
  useEffect(() => {
    gravacoes.current.base = impressaoDaConfig(salvo);
  }, [salvo]);

  /** O rascunho como estava no banco quando a gravação desta aba foi recusada. */
  const [noBanco, setNoBanco] = useState<AppConfig | null>(null);
  const [vendoConflito, setVendoConflito] = useState(false);
  const router = useRouter();

  const mudou = useMemo(() => JSON.stringify(config) !== JSON.stringify(salvo), [config, salvo]);
  const problemas = useMemo(() => validarConfig(config), [config]);
  const todosOsProblemas = problemas.length > 0 ? problemas : problemasDoServidor;

  const situacao: SituacaoDoRascunho =
    gravacao.tipo === 'salvando' || gravacao.tipo === 'erro' || gravacao.tipo === 'conflito'
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
    if (noBanco !== null) {
      // No meio de um conflito, o rascunho mais novo vai para a escolha — e
      // não por cima do que a pessoa mudou aqui e ainda não decidiu.
      if (doServidor !== conteudoDaConfig(noBanco)) setNoBanco(configInicialDoServidor);
    } else if (doServidor !== conteudoDaConfig(salvo) && !emVoo.includes(doServidor)) {
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

  /** O servidor recusou: o rascunho de lá tem outro conteúdo. Para tudo e pergunta. */
  const entrarEmConflito = useCallback((doBanco: AppConfig) => {
    gravacoes.current.conflito = true;
    setNoBanco(doBanco);
    setVendoConflito(true);
    setGravacao({ tipo: 'conflito' });
  }, []);

  /**
   * Restaurar vai em cima do rascunho desta tela, como gravar. Espera as
   * gravações a caminho: a base só vale depois que elas voltam.
   */
  const restaurar = useCallback(
    async (versao: number): Promise<EstadoDoEditor> => {
      await gravacoes.current.fila;
      const estado = await restaurarVersao(storeId, versao, gravacoes.current.base);
      if (estado.conflito !== undefined) entrarEmConflito(estado.conflito.noBanco);
      return estado;
    },
    [entrarEmConflito, storeId],
  );

  /** Grava ESTA config, depois de qualquer gravação que já esteja a caminho. */
  const gravar = useCallback(
    (alvo: AppConfig) => {
      const estado = gravacoes.current;
      if (estado.conflito) return;
      const conteudo = conteudoDaConfig(alvo);
      setGravacao({ tipo: 'salvando' });
      setEmVoo((lista) => [...lista, conteudo]);
      estado.fila = estado.fila.then(async () => {
        try {
          // Uma gravação que já estava na fila quando a anterior deu conflito.
          if (estado.conflito) return;
          const resultado = await salvarConfig(storeId, alvo, estado.base);
          setProblemasDoServidor(resultado.problemas ?? []);
          if (resultado.ok === true) {
            estado.base = impressaoDaConfig(alvo);
            setSalvo(alvo);
            setGravacao({ tipo: 'salvo', em: new Date() });
          } else if (resultado.conflito !== undefined) {
            entrarEmConflito(resultado.conflito.noBanco);
          } else {
            setGravacao({
              tipo: 'erro',
              mensagem: resultado.mensagem ?? 'Não foi possível salvar o rascunho.',
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
    [entrarEmConflito, storeId],
  );

  // Um instante depois de a pessoa parar de mexer, grava. Com ponto a
  // corrigir, espera: gravar poria no rascunho algo que não pode ir ao ar.
  useEffect(() => {
    const estado = gravacoes.current;
    if (somenteLeitura || gravacao.tipo === 'conflito' || !mudou || problemas.length > 0) {
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
  }, [config, gravacao.tipo, gravar, mudou, problemas.length, somenteLeitura]);

  /*
   * Sair da tela no meio da pausa não pode perder a mudança. O `beforeunload`
   * só pega fechar e recarregar a aba; ir para outra tela pelo menu do painel
   * desmonta o editor sem passar por ele. Então a gravação que esperava sai
   * na hora, na mesma fila — e, como a tela já foi embora, um erro vira aviso.
   */
  useEffect(() => {
    const estado = gravacoes.current;
    return () => {
      if (estado.conflito) {
        // Sair sem decidir: o que esta aba mudou fica sem gravar, e a pessoa sabe.
        toast.error(
          'As mudanças que você fez no app nesta aba não foram salvas: o rascunho tinha mudado em outro lugar.',
        );
        return;
      }
      const alvo = estado.pendente;
      if (alvo === null) return;
      estado.pendente = null;
      estado.fila = estado.fila.then(async () => {
        const falha = 'A última mudança no app não foi salva. Volte ao editor e confira.';
        try {
          const resultado = await salvarConfig(storeId, alvo, estado.base);
          if (resultado.conflito !== undefined) {
            toast.error(
              'A última mudança no app não foi salva: o rascunho tinha mudado em outro lugar. Volte ao editor e confira.',
            );
          } else if (resultado.ok !== true) toast.error(resultado.mensagem ?? falha);
        } catch {
          toast.error(falha);
        }
      });
    };
  }, [storeId]);

  /*
   * Desfazer é trazer o conteúdo da versão no ar para a tela — e o salvamento
   * automático grava, pela mesma fila de sempre. Sem ida ao servidor para
   * "restaurar", não há como uma gravação que esperava a pausa chegar DEPOIS e
   * desfazer o desfazer. `version` e `store` ficam os do rascunho: são do
   * servidor, e ele os reescreve de qualquer forma.
   */
  function desfazer() {
    if (publicada?.config == null) return;
    setConfig({ ...publicada.config, version: config.version, store: config.store });
    setConfirmandoDesfazer(false);
    toast.success('Mudanças desfeitas: o rascunho voltou a ser igual à versão no ar.');
  }

  /*
   * O conflito se resolve aqui, sem recarregar: ou a tela passa a mostrar o
   * rascunho de lá (e o que esta aba não salvou é descartado), ou o de lá
   * vira a base e o salvamento automático grava o desta aba por cima.
   */
  function ficarComODoBanco() {
    if (noBanco === null) return;
    const estado = gravacoes.current;
    estado.base = impressaoDaConfig(noBanco);
    estado.conflito = false;
    setConfig(noBanco);
    setSalvo(noBanco);
    setNoBanco(null);
    setVendoConflito(false);
    setGravacao({ tipo: 'salvo', em: null });
    // A versão, o histórico e o que está no ar podem ter mudado junto.
    router.refresh();
    toast.success('Pronto: o editor mostra o rascunho mais novo.');
  }

  function ficarComODestaAba() {
    if (noBanco === null) return;
    const estado = gravacoes.current;
    estado.base = impressaoDaConfig(noBanco);
    estado.conflito = false;
    setSalvo(noBanco);
    setNoBanco(null);
    setVendoConflito(false);
    setGravacao({ tipo: 'salvo', em: null });
  }

  const conflito = useMemo(() => {
    if (noBanco === null) return null;
    // `version` e `store` o servidor reescreve sozinho: não são mudança de ninguém.
    const comoSalvo = { ...noBanco, version: salvo.version, store: salvo.store };
    return {
      la: diferencasDaConfig(salvo, comoSalvo),
      aqui: diferencasDaConfig(salvo, config),
    };
  }, [config, noBanco, salvo]);

  function publicar() {
    iniciarPublicar(() => {
      // A lista do que vai ao ar sai desta tela: publica só se o banco tiver o mesmo.
      void publicarConfig(storeId, gravacoes.current.base).then((estado) => {
        setConfirmandoPublicacao(false);
        setProblemasDoServidor(estado.problemas ?? []);
        if (estado.conflito !== undefined) entrarEmConflito(estado.conflito.noBanco);
        else if (estado.ok === true) toast.success(estado.mensagem ?? 'Publicado.');
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

      {/*
       * Três colunas na tela larga (seção 9 do plano: navegação das seções ·
       * propriedades · o celular ao vivo). Na média, as seções sobem para uma
       * faixa em cima e ficam as duas colunas; no celular, tudo empilha.
       */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[176px_minmax(0,1fr)_320px]">
        <nav
          aria-label="Seções do editor"
          className="flex flex-wrap gap-1 lg:col-span-2 xl:sticky xl:top-20 xl:col-span-1 xl:flex-col xl:self-start"
        >
          {SECOES.map((item) => {
            const Icone = item.icone;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={item.id === secao ? 'page' : undefined}
                onClick={() => {
                  setSecao(item.id);
                }}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
                  item.id === secao
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60',
                )}
              >
                <Icone className="size-4 shrink-0" aria-hidden />
                {item.rotulo}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
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
                  nomeDoApp={nomeDoApp}
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
                  storeId={storeId}
                  temaDaLoja={temaDaLoja}
                  lojaNaShopify={lojaNaShopify}
                />
              ) : null}
              {secao === 'recursos' ? (
                <SecaoRecursos
                  storeId={storeId}
                  config={config}
                  aoMudar={setConfig}
                  aoVerSlide={(indice) => {
                    setSlideEmFoco({ indice });
                  }}
                  somenteLeitura={somenteLeitura}
                  pushConfigurado={pushConfigurado}
                  numeroExigivel={numeroExigivel}
                />
              ) : null}
              {secao === 'versoes' ? (
                <SecaoVersoes
                  storeId={storeId}
                  rascunho={config}
                  versoes={historico}
                  somenteLeitura={somenteLeitura}
                  fuso={fuso}
                  restaurar={restaurar}
                />
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <Previa
            config={config}
            abaAtiva={abaDaPrevia}
            aoTrocarAba={setAbaDaPrevia}
            lojaId={storeId}
            caminho={caminhoNaPrevia}
            selecionando={selecionando}
            aoEscolherSeletor={aoEscolherSeletor}
            identidade={{ nomeDoApp, urlDoIcone, urlDaSplash, fundo: fundoDoApp(config) }}
            slideEmFoco={slideEmFoco}
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
          aoResolverConflito={() => {
            setVendoConflito(true);
          }}
          aoPublicar={() => {
            setConfirmandoPublicacao(true);
          }}
          aoDesfazer={() => {
            setConfirmandoDesfazer(true);
          }}
        />
      )}

      <AlertDialog open={vendoConflito && conflito !== null} onOpenChange={setVendoConflito}>
        <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>O rascunho mudou em outro lugar</AlertDialogTitle>
            <AlertDialogDescription>
              Enquanto você editava aqui, o rascunho foi salvo em outra aba ou por outra pessoa da
              equipe. Para não apagar nada sem você ver, esta aba parou de salvar. Escolha com qual
              versão continuar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {conflito === null ? null : (
            <div className="space-y-4">
              <section aria-labelledby="conflito-la" className="space-y-2">
                <h3 id="conflito-la" className="text-sm font-medium">
                  O que mudou lá
                </h3>
                {conflito.la.length > 0 ? (
                  <ListaDeDiferencas diferencas={conflito.la} maximo={8} />
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Ajustes que não aparecem nesta lista.
                  </p>
                )}
              </section>
              <section aria-labelledby="conflito-aqui" className="space-y-2">
                <h3 id="conflito-aqui" className="text-sm font-medium">
                  O que você mudou aqui e ainda não foi salvo
                </h3>
                {conflito.aqui.length > 0 ? (
                  <ListaDeDiferencas diferencas={conflito.aqui} maximo={8} />
                ) : (
                  <p className="text-muted-foreground text-sm">Nada: não há o que perder aqui.</p>
                )}
              </section>
              <p className="text-muted-foreground text-sm">
                {conflito.aqui.length > 0
                  ? 'Ficar com a versão de lá descarta o que você mudou aqui. Ficar com a desta aba grava por cima, e o que mudou lá se perde.'
                  : 'O editor passa a mostrar a versão de lá.'}
              </p>
            </div>
          )}
          <AlertDialogFooter>
            {conflito !== null && conflito.aqui.length > 0 ? (
              <Button type="button" variant="outline" onClick={ficarComODestaAba}>
                Ficar com a desta aba
              </Button>
            ) : null}
            <Button type="button" onClick={ficarComODoBanco}>
              Ficar com a versão de lá
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmandoDesfazer} onOpenChange={setConfirmandoDesfazer}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mudancas === 1 ? 'Desfazer a mudança?' : `Desfazer as ${String(mudancas)} mudanças?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              O rascunho volta a ser igual à versão {publicada?.version}, a que está no ar. O que
              foi mudado desde a última publicação se perde. Nome, ícone e tela de abertura não
              mudam: eles não fazem parte do rascunho.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={desfazer}>Desfazer mudanças</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmandoPublicacao} onOpenChange={setConfirmandoPublicacao}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publicar a versão {versao}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  O app de todos os seus clientes passa a usar esta configuração em até um minuto. A
                  versão que está no ar hoje continua no histórico, e dá para voltar a ela.
                </p>
                {publicada?.config == null ? (
                  <p>É a primeira publicação: o app passa a usar tudo o que está no rascunho.</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-foreground font-medium">O que vai ao ar:</p>
                    <ListaDeDiferencas
                      diferencas={diferencasDaConfig(publicada.config, config)}
                      maximo={8}
                    />
                  </div>
                )}
              </div>
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

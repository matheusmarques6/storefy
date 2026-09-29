/**
 * A casca da loja: abas nativas sobre WebViews persistentes (seção 5.3/5.4).
 *
 * Todas as abas de WebView ficam montadas ao mesmo tempo, e só a ativa aparece.
 * É o que faz a troca de aba ser instantânea e preservar a rolagem de cada uma.
 * A tela também é quem executa o que a página pede pelo bridge — vibrar,
 * compartilhar, abrir fora — e quem trata o botão voltar do Android.
 */
import NetInfo from '@react-native-community/netinfo';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import * as StoreReview from 'expo-store-review';
import { StatusBar } from 'expo-status-bar';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AppConfig } from '@storefy/config-schema';
import type { NativeToWeb } from '@storefy/bridge';
import {
  abaDaConta,
  abaParaCaminho,
  abasUsaveis,
  caminhoDaBusca,
  resolverAbas,
  type AbaResolvida,
} from '../config/abas';
import { avisoDoTopo, avisoFoiFechado } from '../config/aviso';
import { gravarAvisoFechado, lerAvisoFechado } from '../config/fontes';
import { BarraDeAbas } from '../navegacao/barra-de-abas';
import { AbaWebView, type ControleDaAba } from '../webview/aba-webview';
import type { ContextoDoApp } from '../webview/scripts';
import type { AcaoNativa, ContextoDasAcoes } from '../bridge/acoes';
import { usarPush } from '../push/usar-push';
import type { DestinoDoPush } from '../push/deep-link';
import type { Ambiente } from '../nucleo/ambiente';
import { ehDadoDaConta } from '../nucleo/biometria';
import {
  compraConcluidaNaUrl,
  entrouNoCheckout,
  saiuDaConta,
  vibrarNoCarrinho,
} from '../webview/jornada';
import { usarProtecaoDaConta } from '../nucleo/usar-biometria';
import { PrePromptDePush } from './pre-prompt';
import { AjustesDoApp, EntradaDosAjustes } from './ajustes';
import { CampoDeBusca } from './campo-de-busca';
import { textoDaVersao, urlDaPolitica } from '../push/ajustes';
import { credenciaisDe } from '../push/api';
import { CaixaDeAvisos } from './caixa-de-avisos';
import { ContaProtegida } from './conta-protegida';
import { FaixaDeAviso } from './faixa-de-aviso';

interface Props {
  config: AppConfig;
  ambiente: Ambiente;
  contextoDoApp: ContextoDoApp;
  contextoDasAcoes: ContextoDasAcoes;
  /** Chamado na primeira página carregada, para sumir com a splash. */
  aoFicarPronto: () => void;
}

export function Loja({
  config,
  ambiente,
  contextoDoApp,
  contextoDasAcoes,
  aoFicarPronto,
}: Props): React.ReactNode {
  const abas = useMemo(
    () => abasUsaveis(resolverAbas(config), { push: contextoDasAcoes.push }),
    [config, contextoDasAcoes.push],
  );
  const primeira = abas[0];
  const conta = useMemo(() => abaDaConta(abas), [abas]);
  const protecao = usarProtecaoDaConta(config.features.biometricLogin && conta !== null);

  const [ativa, setAtiva] = useState(primeira?.id ?? '');
  const [itensNoCarrinho, setItensNoCarrinho] = useState(0);
  const [semConexao, setSemConexao] = useState(false);
  const [controles, setControles] = useState<ReadonlyMap<string, ControleDaAba>>(new Map());
  const [linkPendente, setLinkPendente] = useState<{ aba: string; caminho: string } | null>(null);

  /*
   * A config pode mudar com o app aberto — a busca em segundo plano traz uma
   * versão nova, e o lojista pode ter removido uma aba. Sem isto, a aba ativa
   * apontaria para um id que não existe mais e a tela ficaria vazia.
   */
  useEffect(() => {
    if (primeira === undefined) return;
    if (!abas.some((aba) => aba.id === ativa)) setAtiva(primeira.id);
  }, [abas, ativa, primeira]);

  /* ------------------------------------------------- o aviso no topo */

  const aviso = useMemo(() => avisoDoTopo(config), [config]);
  /**
   * O texto do aviso que o cliente fechou. `undefined` enquanto o disco não
   * responde: a faixa só entra depois, em vez de aparecer e sumir num piscar.
   */
  const [avisoFechado, setAvisoFechado] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelado = false;
    const foiCancelado = (): boolean => cancelado;
    void lerAvisoFechado().then((texto) => {
      if (!foiCancelado()) setAvisoFechado(texto);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  const fecharAviso = useCallback((): void => {
    if (aviso === null) return;
    setAvisoFechado(aviso.texto);
    void gravarAvisoFechado(aviso.texto);
  }, [aviso]);

  /* ------------------------------------------------------------ conexão */

  useEffect(() => {
    const cancelar = NetInfo.addEventListener((estado) => {
      // `isInternetReachable` é null enquanto o sistema ainda não sabe; só
      // `false` explícito conta como offline, senão a tela piscaria à toa.
      setSemConexao(estado.isConnected === false || estado.isInternetReachable === false);
    });
    return cancelar;
  }, []);

  /* --------------------------------------------------------- as abas */

  const registrarControle = useCallback((id: string, controle: ControleDaAba | null): void => {
    setControles((anteriores) => {
      const copia = new Map(anteriores);
      if (controle === null) copia.delete(id);
      else copia.set(id, controle);
      return copia;
    });
  }, []);

  const aoTocarAba = useCallback(
    (id: string, reabrir: boolean): void => {
      if (reabrir) controles.get(id)?.reabrir();
      else setAtiva(id);
    },
    [controles],
  );

  /* ------------------------------------------------- voltar no Android */

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const inscricao = BackHandler.addEventListener('hardwareBackPress', () => {
      // Com a trava na frente, a página da conta por baixo não é de quem está
      // com o celular: o voltar não mexe nela.
      if (ativa === conta?.id && protecao.situacao !== 'livre') return false;
      const controle = controles.get(ativa);
      if (controle?.podeVoltar() === true) {
        controle.voltar();
        return true;
      }
      // `false` deixa o sistema fechar o app, que é o esperado na raiz.
      return false;
    });
    return () => {
      inscricao.remove();
    };
  }, [ativa, controles, conta, protecao.situacao]);

  /* ------------------------------------------------------ deep links */

  const abrirCaminho = useCallback(
    (url: string): void => {
      let caminho: string;
      try {
        // Query e fragmento vão junto: `destinoDoPush` os preserva de
        // propósito, e cortá-los aqui levaria `/search?q=tenis` a uma busca
        // vazia.
        const alvo = new URL(url, config.store.url);
        caminho = `${alvo.pathname}${alvo.search}${alvo.hash}`;
      } catch {
        return;
      }
      const destino = abaParaCaminho(abas, caminho);
      if (destino === null) return;
      setAtiva(destino.aba.id);
      setLinkPendente({ aba: destino.aba.id, caminho: destino.caminho });
    },
    [abas, config.store.url],
  );

  /**
   * Com a conta protegida, os dados dela só abrem na aba Conta, onde a trava
   * está. O ícone de conta do cabeçalho do tema, tocado na aba Início, cai
   * aqui: a navegação é cancelada lá e refeita na aba Conta.
   */
  const prefixoDaConta = useMemo(() => {
    if (conta?.url == null) return null;
    try {
      return new URL(conta.url).pathname;
    } catch {
      return null;
    }
  }, [conta]);

  const desviarParaConta = useCallback(
    (url: string): boolean => {
      if (conta === null || prefixoDaConta === null || !protecao.protegida) return false;
      let alvo: URL;
      let loja: URL;
      try {
        alvo = new URL(url);
        loja = new URL(config.store.url);
      } catch {
        return false;
      }
      const caminho = `${alvo.pathname}${alvo.search}${alvo.hash}`;
      if (!ehDadoDaConta(caminho, prefixoDaConta)) return false;
      setAtiva(conta.id);
      // A conta nova da Shopify mora em `shopify.com`: fora do host da loja,
      // a aba Conta precisa do endereço inteiro, e não só do caminho.
      setLinkPendente({ aba: conta.id, caminho: alvo.host === loja.host ? caminho : alvo.href });
      return true;
    },
    [conta, config.store.url, prefixoDaConta, protecao.protegida],
  );

  /**
   * Para onde levar o toque numa notificação.
   *
   * `abrirCaminho` já sabe escolher a aba e guardar o caminho até a WebView
   * montar — o que muda aqui é só a origem. `abrir` não faz nada de propósito:
   * o app já está abrindo, e mandar o cliente para a home apagaria a navegação
   * em que ele estava.
   */
  const navegarPorPush = useCallback(
    (destino: DestinoDoPush): void => {
      if (destino.destino === 'caminho') abrirCaminho(destino.caminho);
    },
    [abrirCaminho],
  );

  const push = usarPush({
    ambiente,
    config,
    ativo: contextoDasAcoes.push,
    navegar: navegarPorPush,
  });

  // A URL de abertura é lida UMA vez. O efeito roda de novo quando a config
  // muda, e reler levaria o cliente de volta ao link toda vez que isso
  // acontecesse — no meio da navegação dele.
  const inicialLida = useRef(false);
  useEffect(() => {
    if (!inicialLida.current) {
      inicialLida.current = true;
      void Linking.getInitialURL().then((url) => {
        if (url !== null) abrirCaminho(url);
      });
    }
    const inscricao = Linking.addEventListener('url', ({ url }) => {
      abrirCaminho(url);
    });
    return () => {
      inscricao.remove();
    };
  }, [abrirCaminho]);

  useEffect(() => {
    if (linkPendente === null) return;
    // A aba pode não estar montada ainda quando o link chega na abertura.
    const controle = controles.get(linkPendente.aba);
    if (controle === undefined) return;
    controle.irPara(linkPendente.caminho);
    setLinkPendente(null);
  }, [controles, linkPendente]);

  /* -------------------------------------------- o que a página pediu */

  /*
   * A última leitura do carrinho, fora do estado: cada aba lê o carrinho ao
   * abrir, e a comparação precisa do valor da mensagem anterior, não do que já
   * foi desenhado. O token é o que liga o checkout ao carrinho.
   */
  const ultimaContagem = useRef<number | null>(null);
  const tokenDoCarrinho = useRef<string | null>(null);
  const clienteIdentificado = useRef<string | null>(null);

  /* ------------------------------------------------ M12: os ajustes */

  const [ajustesAbertos, setAjustesAbertos] = useState(false);
  const { lerNotificacoes } = push;
  const abrirAjustes = useCallback((): void => {
    // Relê ao abrir: a permissão pode ter mudado nos ajustes do celular.
    lerNotificacoes();
    setAjustesAbertos(true);
  }, [lerNotificacoes]);
  const politica = useMemo(() => urlDaPolitica(credenciaisDe(ambiente)), [ambiente]);
  // Sem caixa de avisos, a engrenagem não tem onde morar: vai para a aba Conta.
  const semCaixaDeAvisos = !abas.some((aba) => aba.tipo === 'notifications');

  /* M08: o campo nativo leva a aba Busca à página de resultados da loja. */
  const buscar = useCallback(
    (aba: AbaResolvida, termo: string): void => {
      if (aba.url === null) return;
      const caminho = caminhoDaBusca(aba.url, termo);
      if (caminho !== null) controles.get(aba.id)?.irPara(caminho);
    },
    [controles],
  );

  const aoAgir = useCallback(
    /*
     * `responder` só existe quando a ação veio de uma mensagem da página; as
     * que o app deduz do endereço (`aoVerEndereco`) não têm a quem responder.
     */
    (acao: AcaoNativa, responder?: (mensagem: NativeToWeb) => void): void => {
      switch (acao.tipo) {
        case 'carrinho':
          // Item entrou no carrinho: a confirmação que o dedo sente.
          if (vibrarNoCarrinho(ultimaContagem.current, acao.count)) {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          ultimaContagem.current = acao.count;
          if (acao.token !== undefined) tokenDoCarrinho.current = acao.token;
          setItensNoCarrinho(acao.count);
          /*
           * O badge é o efeito visível; o resto é o que faz o carrinho
           * abandonado existir. As tags alimentam a segmentação do lojista e o
           * evento agenda (ou cancela) o push no servidor.
           */
          push.aoMudarCarrinho({
            count: acao.count,
            totalCents: acao.totalCents,
            quandoMs: Date.now(),
            token: acao.token,
            currency: acao.currency,
          });
          return;

        case 'vibrar':
          void (acao.estilo === 'success'
            ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            : Haptics.impactAsync(
                acao.estilo === 'medium'
                  ? Haptics.ImpactFeedbackStyle.Medium
                  : Haptics.ImpactFeedbackStyle.Light,
              ));
          return;

        case 'compartilhar':
          void Share.share(
            Platform.OS === 'ios'
              ? { url: acao.url, message: acao.title ?? '' }
              : // O Android não tem campo de URL: vai no texto, senão some.
                { message: acao.title == null ? acao.url : `${acao.title}\n${acao.url}` },
          );
          return;

        case 'abrir-fora':
          void Linking.openURL(acao.url);
          return;

        case 'pedido-concluido':
          /*
           * ESTE é o evento que cancela o push de carrinho abandonado. Vem
           * antes da avaliação de propósito: mandar "você esqueceu algo no
           * carrinho" para quem acabou de pagar é o pior push que existe, e
           * `requestReview` é o tipo de chamada que pode demorar.
           */
          push.aoConcluirPedido({ totalCents: acao.totalCents });
          ultimaContagem.current = 0;
          if (!acao.pedirAvaliacao) return;
          void StoreReview.isAvailableAsync().then(async (disponivel) => {
            if (disponivel) await StoreReview.requestReview();
          });
          return;

        case 'pedir-push':
          push.pedirPermissao();
          return;

        case 'abrir-ajustes':
          abrirAjustes();
          return;

        case 'identificar-cliente':
          // Toda página da loja repete quem está logado; o SDK só precisa
          // saber quando MUDA.
          if (acao.customerId === undefined || acao.customerId === clienteIdentificado.current) {
            return;
          }
          clienteIdentificado.current = acao.customerId;
          push.aoIdentificarCliente(acao.customerId);
          return;

        case 'checkout-iniciado':
          push.aoIniciarCheckout(acao.token, itensNoCarrinho);
          return;

        case 'avisar-de-volta': {
          /*
           * O botão da página espera a resposta para dizer "pronto" — ou
           * onde ligar as notificações, ou "tente de novo". Sem ela, ele
           * mentia "pronto" até quando nada era gravado.
           */
          const { variantId } = acao;
          void push.aoPedirAvisoDeVolta({ variantId, path: acao.path }).then(
            (resposta) => {
              responder?.({ type: 'NOTIFY_WHEN_BACK_RESULT', variantId, ...resposta });
            },
            () => {
              responder?.({
                type: 'NOTIFY_WHEN_BACK_RESULT',
                variantId,
                ok: false,
                reason: 'unavailable',
              });
            },
          );
          return;
        }

        case 'recusar-aviso-de-volta':
          responder?.({
            type: 'NOTIFY_WHEN_BACK_RESULT',
            variantId: acao.variantId,
            ok: false,
            reason: 'unavailable',
          });
          return;

        case 'ignorar':
          return;

        default: {
          // Uma ação nova sem o seu `case` não compila: foi assim que o "me
          // avise" ficou sem fazer nada — o pedido chegava e morria aqui.
          const esquecida: never = acao;
          return esquecida;
        }
      }
    },
    [abrirAjustes, itensNoCarrinho, push],
  );

  /* ------------------------------------------- o que o endereço conta */

  /*
   * O checkout da Shopify não é do tema e não avisa ninguém; o endereço de
   * cada página, sim (`webview/jornada.ts`). Cada compra e cada checkout contam
   * uma vez por sessão: a página de obrigado recarrega e o mesmo endereço
   * chega de mais de um jeito.
   */
  const comprasVistas = useRef(new Set<string>());
  const checkoutsVistos = useRef(new Set<string>());

  const aoVerEndereco = useCallback(
    (url: string): void => {
      const compra = compraConcluidaNaUrl(url);
      if (compra !== null) {
        if (comprasVistas.current.has(compra)) return;
        comprasVistas.current.add(compra);
        aoAgir({
          tipo: 'pedido-concluido',
          orderId: compra,
          pedirAvaliacao: contextoDasAcoes.pedirAvaliacao,
        });
        return;
      }

      if (entrouNoCheckout(url)) {
        const token = tokenDoCarrinho.current;
        if (!contextoDasAcoes.eventos || token === null) return;
        if (checkoutsVistos.current.has(token)) return;
        checkoutsVistos.current.add(token);
        aoAgir({ tipo: 'checkout-iniciado', token });
        return;
      }

      if (saiuDaConta(url) && contextoDasAcoes.push && clienteIdentificado.current !== null) {
        clienteIdentificado.current = null;
        push.aoIdentificarCliente(undefined);
      }
    },
    [
      aoAgir,
      contextoDasAcoes.eventos,
      contextoDasAcoes.pedirAvaliacao,
      contextoDasAcoes.push,
      push,
    ],
  );

  /* ------------------------------------------------------ primeira carga */

  const jaAvisou = useRef(false);
  const aoCarregar = useCallback((): void => {
    if (jaAvisou.current) return;
    jaAvisou.current = true;
    aoFicarPronto();
  }, [aoFicarPronto]);

  // A aba Conta trancada pode ser a primeira: a página dela só carrega depois
  // do desbloqueio, e a splash não pode ficar esperando por isso.
  const contaEhPrimeira = conta !== null && conta.id === primeira?.id;
  useEffect(() => {
    if (contaEhPrimeira && protecao.situacao === 'trancada') aoCarregar();
  }, [contaEhPrimeira, protecao.situacao, aoCarregar]);

  if (primeira === undefined) return null;

  return (
    <View style={[estilos.tela, { backgroundColor: config.theme.background }]}>
      <StatusBar style={config.theme.statusBar === 'light' ? 'light' : 'dark'} />
      <SafeAreaView edges={['top']} style={estilos.area}>
        {aviso !== null && avisoFechado !== undefined && !avisoFoiFechado(aviso, avisoFechado) ? (
          <FaixaDeAviso
            aviso={aviso}
            tema={config.theme}
            aoAbrir={abrirCaminho}
            aoFechar={fecharAviso}
          />
        ) : null}
        {/*
         * Toda aba vira uma WebView. A Fase 3 põe aqui a caixa de avisos
         * nativa, e até lá `abasUsaveis` não deixa uma aba dessas chegar até
         * este ponto. Se chegasse — config só com abas nativas —, a loja abre
         * no lugar, porque tela vazia com barra de abas é pior.
         */}
        {abas.map((aba) =>
          aba.id === conta?.id ? (
            /*
             * M06: a conta com Face ID. Antes do primeiro desbloqueio a página
             * nem é carregada; depois, fica montada por baixo da trava quando
             * ela volta, para o cliente reencontrar a conta onde a deixou.
             */
            <Fragment key={aba.id}>
              {protecao.situacao === 'livre' || protecao.jaAbriu ? (
                <AbaWebView
                  aba={aba}
                  config={config}
                  contextoDoApp={contextoDoApp}
                  contextoDasAcoes={contextoDasAcoes}
                  visivel={aba.id === ativa && protecao.situacao === 'livre'}
                  semConexao={semConexao}
                  aoAgir={aoAgir}
                  registrarControle={registrarControle}
                  aoCarregar={aba.id === primeira.id ? aoCarregar : undefined}
                  aoVerEndereco={aoVerEndereco}
                  cabecalho={
                    semCaixaDeAvisos ? (
                      <EntradaDosAjustes tema={config.theme} aoAbrir={abrirAjustes} />
                    ) : undefined
                  }
                />
              ) : null}
              {protecao.situacao === 'livre' ? null : (
                <View
                  style={[
                    estilos.cobertura,
                    { backgroundColor: config.theme.background },
                    aba.id === ativa ? null : estilos.escondida,
                  ]}
                  pointerEvents={aba.id === ativa ? 'auto' : 'none'}
                  accessibilityElementsHidden={aba.id !== ativa}
                  importantForAccessibility={aba.id === ativa ? 'auto' : 'no-hide-descendants'}
                >
                  {protecao.situacao === 'trancada' ? (
                    <ContaProtegida
                      visivel={aba.id === ativa}
                      tema={config.theme}
                      pedindo={protecao.pedindo}
                      aviso={protecao.aviso}
                      aoDesbloquear={protecao.desbloquear}
                    />
                  ) : null}
                </View>
              )}
            </Fragment>
          ) : aba.webview ? (
            <AbaWebView
              key={aba.id}
              aba={aba}
              config={config}
              contextoDoApp={contextoDoApp}
              contextoDasAcoes={contextoDasAcoes}
              visivel={aba.id === ativa}
              semConexao={semConexao}
              aoAgir={aoAgir}
              registrarControle={registrarControle}
              aoCarregar={aba.id === primeira.id ? aoCarregar : undefined}
              desviar={desviarParaConta}
              aoVerEndereco={aoVerEndereco}
              cabecalho={
                aba.tipo === 'search' ? (
                  <CampoDeBusca
                    tema={config.theme}
                    nomeDaLoja={config.store.name}
                    aoBuscar={(termo) => {
                      buscar(aba, termo);
                    }}
                  />
                ) : undefined
              }
            />
          ) : (
            /*
             * A caixa de avisos é nativa. Fica montada junto com as WebViews e
             * escondida quando não é a ativa, pelo mesmo motivo delas: montar e
             * desmontar a cada toque perderia a rolagem e piscaria a lista.
             */
            <View
              key={aba.id}
              style={[estilos.area, aba.id === ativa ? null : estilos.escondida]}
              pointerEvents={aba.id === ativa ? 'auto' : 'none'}
              accessibilityElementsHidden={aba.id !== ativa}
              importantForAccessibility={aba.id === ativa ? 'auto' : 'no-hide-descendants'}
            >
              <CaixaDeAvisos
                avisos={push.avisos}
                carregando={push.caixaCarregando}
                tema={config.theme}
                aoRecarregar={push.recarregarCaixa}
                aoMarcarTudoLido={push.marcarTudoLido}
                aoAbrirAjustes={abrirAjustes}
                aoTocar={(aviso) => {
                  push.marcarAvisoLido(aviso.id);
                  if (aviso.deepLink !== null) abrirCaminho(aviso.deepLink);
                }}
              />
            </View>
          ),
        )}
      </SafeAreaView>
      {abas.length > 1 ? (
        <BarraDeAbas
          abas={abas}
          ativa={ativa}
          itensNoCarrinho={itensNoCarrinho}
          avisosNaoLidos={push.avisosNaoLidos}
          tema={config.theme}
          aoTocar={aoTocarAba}
        />
      ) : null}
      <PrePromptDePush
        visivel={push.mostrarPrePrompt}
        nomeDaLoja={config.store.name}
        tema={config.theme}
        aoAceitar={push.aceitarNoPrePrompt}
        aoRecusar={push.recusarNoPrePrompt}
      />
      <AjustesDoApp
        visivel={ajustesAbertos}
        tema={config.theme}
        nomeDaLoja={config.store.name}
        notificacoes={push.notificacoes}
        mudando={push.mudandoNotificacoes}
        erro={push.erroNasNotificacoes}
        aoLigar={push.ligarAsNotificacoes}
        aoDesligar={push.desligarAsNotificacoes}
        aoTentarDeNovo={push.lerNotificacoes}
        versao={textoDaVersao(ambiente.appVersion, ambiente.buildAtual)}
        urlDaPolitica={politica}
        aoFechar={() => {
          setAjustesAbertos(false);
        }}
      />
    </View>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1 },
  area: { flex: 1 },
  // Por cima da página da conta, do mesmo tamanho que ela.
  cobertura: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  // Fora da tela em vez de `display: none`: a lista guarda a posição de
  // rolagem, e o `display` a reconstrói do zero a cada volta.
  escondida: { position: 'absolute', left: -10_000, width: 1, height: 1, opacity: 0 },
});

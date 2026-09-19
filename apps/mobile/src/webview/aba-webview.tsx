/**
 * Uma aba de WebView (seção 5.4 do plano).
 *
 * Cada aba tem a SUA instância, montada uma vez e mantida viva enquanto o app
 * existe. As inativas ficam com `display: none`, e não desmontadas: é o que faz
 * a troca de aba ser instantânea e preservar a rolagem. Recarregar a página a
 * cada toque é o que mais denuncia um site embrulhado em app.
 *
 * O `source` é definido uma vez só. Depois disso, quem navega é a própria
 * página — trocar o `source` a cada mudança de URL recarregaria tudo e
 * perderia o histórico de voltar.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentRef,
} from 'react';
import { Linking, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import type {
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewProgressEvent,
} from 'react-native-webview/lib/WebViewTypes';
import { destinoDoLink } from '@storefy/bridge';
import type { AppConfig } from '@storefy/config-schema';
import type { AbaResolvida } from '../config/abas';
import { acaoParaMensagem, type AcaoNativa, type ContextoDasAcoes } from '../bridge/acoes';
import { TelaDeErro, TelaSemConexao } from '../telas/avisos';
import { BarraDeProgresso } from './barra-de-progresso';
import {
  scriptAntesDoConteudo,
  scriptDepoisDoConteudo,
  scriptDoLojista,
  type ContextoDoApp,
} from './scripts';

/** O que a casca da loja pode pedir a uma aba já montada. */
export interface ControleDaAba {
  podeVoltar: () => boolean;
  voltar: () => void;
  recarregar: () => void;
  /** Leva a aba a um caminho da loja (deep link de push). */
  irPara: (caminho: string) => void;
  /** Toque na aba já ativa: volta ao começo. */
  reabrir: () => void;
}

interface Props {
  aba: AbaResolvida;
  config: AppConfig;
  contextoDoApp: ContextoDoApp;
  contextoDasAcoes: ContextoDasAcoes;
  visivel: boolean;
  /** `true` quando o aparelho está sem internet, pelo NetInfo. */
  semConexao: boolean;
  aoAgir: (acao: AcaoNativa) => void;
  registrarControle: (id: string, controle: ControleDaAba | null) => void;
  /** Chamado quando a página termina de carregar. Serve para sumir a splash. */
  aoCarregar?: () => void;
}

type Falha = 'rede' | 'servidor' | null;

export function AbaWebView({
  aba,
  config,
  contextoDoApp,
  contextoDasAcoes,
  visivel,
  semConexao,
  aoAgir,
  registrarControle,
  aoCarregar,
}: Props): React.ReactNode {
  // `ComponentRef<typeof WebView>` e não `WebView`: a classe é genérica, e
  // `useRef<WebView>` fixa um parâmetro que não bate com o que o `ref` espera.
  const referencia = useRef<ComponentRef<typeof WebView>>(null);
  const podeVoltar = useRef(false);
  const [progresso, setProgresso] = useState(0);
  const [falha, setFalha] = useState<Falha>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [noTopo, setNoTopo] = useState(true);
  const [tentativa, setTentativa] = useState(0);

  const inicial = aba.url ?? config.store.url;

  const antes = useMemo(
    () => scriptAntesDoConteudo(config, contextoDoApp),
    [config, contextoDoApp],
  );
  const depois = useMemo(() => scriptDepoisDoConteudo(config), [config]);
  const doLojista = useMemo(() => scriptDoLojista(config), [config]);

  const recarregar = useCallback(() => {
    setFalha(null);
    setProgresso(0);
    referencia.current?.reload();
  }, []);

  const tentarDeNovo = useCallback(() => {
    setFalha(null);
    setProgresso(0);
    // A WebView que falhou não recarrega sozinha de um erro de rede: remontar
    // é o único caminho confiável de volta.
    setTentativa((anterior) => anterior + 1);
  }, []);

  useEffect(() => {
    const controle: ControleDaAba = {
      podeVoltar: () => podeVoltar.current,
      voltar: () => {
        referencia.current?.goBack();
      },
      recarregar,
      irPara: (caminho: string) => {
        const alvo = new URL(caminho, config.store.url).toString();
        // `injectJavaScript` em vez de trocar o `source`: assim a navegação
        // entra no histórico e o botão voltar continua fazendo sentido.
        referencia.current?.injectJavaScript(`location.assign(${JSON.stringify(alvo)});true;`);
      },
      reabrir: () => {
        referencia.current?.injectJavaScript(
          `(function(){try{window.scrollTo({top:0,behavior:'smooth'});}catch(e){window.scrollTo(0,0);}})();true;`,
        );
      },
    };
    registrarControle(aba.id, controle);
    return () => {
      registrarControle(aba.id, null);
    };
  }, [aba.id, config.store.url, recarregar, registrarControle]);

  const aoReceberMensagem = useCallback(
    (evento: WebViewMessageEvent): void => {
      aoAgir(acaoParaMensagem(evento.nativeEvent.data, contextoDasAcoes));
    },
    [aoAgir, contextoDasAcoes],
  );

  const aoPedirNavegacao = useCallback(
    (pedido: WebViewNavigation): boolean => {
      const destino = destinoDoLink(pedido.url, {
        urlAtual: pedido.url,
        dominios: config.store.domains,
      });

      if (destino.destino === 'webview') return true;
      if (destino.destino === 'externo') {
        void Linking.openURL(destino.url).catch(() => {
          // App não instalado ou esquema sem quem atenda. Nada a fazer aqui:
          // bloquear já evitou a tela em branco dentro do app.
        });
      }
      return false;
    },
    [config.store.domains],
  );

  const aoTerminar = useCallback((): void => {
    setProgresso(1);
    setAtualizando(false);
    aoCarregar?.();
    // O JavaScript do lojista vai numa chamada só dele: um erro de sintaxe ali
    // não pode derrubar o observador de carrinho nem a API da página.
    if (doLojista !== null) referencia.current?.injectJavaScript(doLojista);
  }, [aoCarregar, doLojista]);

  const aoErrar = useCallback(
    (evento: WebViewErrorEvent): void => {
      const descricao = evento.nativeEvent.description;
      setAtualizando(false);
      setFalha(
        semConexao || /internet|network|host|offline/i.test(descricao) ? 'rede' : 'servidor',
      );
    },
    [semConexao],
  );

  /*
   * O tipo vem do próprio componente. Dentro do react-native-webview, o evento
   * de rolagem é declarado de dois jeitos que não batem entre si (o `zoomScale`
   * é opcional num e obrigatório no outro); derivar do `prop` evita escolher o
   * lado errado e quebrar a cada atualização do pacote.
   */
  const aoRolar: NonNullable<ComponentProps<typeof WebView>['onScroll']> = (evento) => {
    setNoTopo(evento.nativeEvent.contentOffset.y <= 0);
  };

  const aoErrarHttp = useCallback((evento: WebViewHttpErrorEvent): void => {
    // Só 5xx vira tela de erro. Um 404 é página da loja e o tema já desenha
    // a dele; um 401 é o fluxo normal de conta.
    if (evento.nativeEvent.statusCode >= 500) {
      setAtualizando(false);
      setFalha('servidor');
    }
  }, []);

  const conteudo = (
    <WebView
      key={`${aba.id}:${String(tentativa)}`}
      ref={referencia}
      source={{ uri: inicial }}
      // Injeções: CSS e contexto antes do conteúdo, bridge depois do DOM.
      injectedJavaScriptBeforeContentLoaded={antes}
      injectedJavaScript={depois}
      onMessage={aoReceberMensagem}
      onShouldStartLoadWithRequest={aoPedirNavegacao}
      onNavigationStateChange={(estado: WebViewNavigation): void => {
        podeVoltar.current = estado.canGoBack;
      }}
      onLoadProgress={(evento: WebViewProgressEvent): void => {
        setProgresso(evento.nativeEvent.progress);
      }}
      onLoadEnd={aoTerminar}
      onError={aoErrar}
      onHttpError={aoErrarHttp}
      onScroll={aoRolar}
      // Sessão do checkout: sem os cookies compartilhados, o cliente chega ao
      // pagamento com o carrinho vazio.
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      domStorageEnabled
      javaScriptEnabled
      // `target="_blank"` do tema passa a abrir na mesma WebView, e por isso
      // passa pelo roteador de links acima.
      setSupportMultipleWindows={false}
      allowsBackForwardNavigationGestures
      allowsInlineMediaPlayback
      decelerationRate="normal"
      pullToRefreshEnabled={config.webview.pullToRefresh}
      applicationNameForUserAgent={config.webview.userAgentSuffix}
      // O indicador nativo piscaria junto com a nossa barra de progresso.
      startInLoadingState={false}
      style={estilos.web}
    />
  );

  // No Android o `pullToRefreshEnabled` da WebView não existe; o puxão vem de
  // um `RefreshControl` por fora, ligado só quando a página está no topo —
  // senão ele roubaria a rolagem da página inteira.
  const comPuxar =
    Platform.OS === 'android' && config.webview.pullToRefresh ? (
      <ScrollView
        style={estilos.web}
        contentContainerStyle={estilos.web}
        refreshControl={
          <RefreshControl
            enabled={noTopo}
            refreshing={atualizando}
            onRefresh={(): void => {
              setAtualizando(true);
              recarregar();
            }}
          />
        }
      >
        {conteudo}
      </ScrollView>
    ) : (
      conteudo
    );

  return (
    <View
      style={[estilos.area, visivel ? estilos.visivel : estilos.escondida]}
      // A aba escondida continua montada, mas não deve ser lida nem tocada.
      accessibilityElementsHidden={!visivel}
      importantForAccessibility={visivel ? 'auto' : 'no-hide-descendants'}
      pointerEvents={visivel ? 'auto' : 'none'}
    >
      {comPuxar}
      <BarraDeProgresso valor={progresso} cor={config.theme.primary} />
      {falha !== null ? (
        <View style={estilos.cobertura}>
          {falha === 'rede' ? (
            <TelaSemConexao cores={config.theme} aoTentarDeNovo={tentarDeNovo} />
          ) : (
            <TelaDeErro cores={config.theme} aoTentarDeNovo={tentarDeNovo} />
          )}
        </View>
      ) : null}
    </View>
  );
}

/** `position: absolute` cobrindo o pai inteiro. */
const COBRE_TUDO = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

const estilos = StyleSheet.create({
  area: COBRE_TUDO,
  visivel: { opacity: 1 },
  // `display: none` mantém a instância viva com a rolagem onde estava.
  escondida: { display: 'none' },
  web: { flex: 1 },
  cobertura: COBRE_TUDO,
});

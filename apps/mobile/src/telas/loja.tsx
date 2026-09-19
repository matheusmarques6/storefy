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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AppConfig } from '@storefy/config-schema';
import { abaParaCaminho, abasUsaveis, resolverAbas } from '../config/abas';
import { BarraDeAbas } from '../navegacao/barra-de-abas';
import { AbaWebView, type ControleDaAba } from '../webview/aba-webview';
import type { ContextoDoApp } from '../webview/scripts';
import type { AcaoNativa, ContextoDasAcoes } from '../bridge/acoes';

interface Props {
  config: AppConfig;
  contextoDoApp: ContextoDoApp;
  contextoDasAcoes: ContextoDasAcoes;
  /** Chamado na primeira página carregada, para sumir com a splash. */
  aoFicarPronto: () => void;
}

export function Loja({
  config,
  contextoDoApp,
  contextoDasAcoes,
  aoFicarPronto,
}: Props): React.ReactNode {
  const abas = useMemo(
    () => abasUsaveis(resolverAbas(config), { push: contextoDasAcoes.push }),
    [config, contextoDasAcoes.push],
  );
  const primeira = abas[0];

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
  }, [ativa, controles]);

  /* ------------------------------------------------------ deep links */

  const abrirCaminho = useCallback(
    (url: string): void => {
      let caminho: string;
      try {
        caminho = new URL(url, config.store.url).pathname;
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

  const aoAgir = useCallback((acao: AcaoNativa): void => {
    switch (acao.tipo) {
      case 'carrinho':
        setItensNoCarrinho(acao.count);
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
        if (!acao.pedirAvaliacao) return;
        void StoreReview.isAvailableAsync().then(async (disponivel) => {
          if (disponivel) await StoreReview.requestReview();
        });
        return;

      // Estes três dependem de recurso que este build ainda não tem, e
      // `acaoParaMensagem` já devolveu `ignorar` quando é o caso. Chegar aqui
      // significa que o recurso existe e a Fase correspondente liga o fio.
      case 'pedir-push':
      case 'identificar-cliente':
      case 'checkout-iniciado':
        return;

      case 'ignorar':
        return;
    }
  }, []);

  /* ------------------------------------------------------ primeira carga */

  const jaAvisou = useRef(false);
  const aoCarregar = useCallback((): void => {
    if (jaAvisou.current) return;
    jaAvisou.current = true;
    aoFicarPronto();
  }, [aoFicarPronto]);

  if (primeira === undefined) return null;

  return (
    <View style={[estilos.tela, { backgroundColor: config.theme.background }]}>
      <StatusBar style={config.theme.statusBar === 'light' ? 'light' : 'dark'} />
      <SafeAreaView edges={['top']} style={estilos.area}>
        {/*
         * Toda aba vira uma WebView. A Fase 4 põe aqui a caixa de avisos
         * nativa, e até lá `abasUsaveis` não deixa uma aba dessas chegar até
         * este ponto. Se chegasse — config só com abas nativas —, a loja abre
         * no lugar, porque tela vazia com barra de abas é pior.
         */}
        {abas.map((aba) => (
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
          />
        ))}
      </SafeAreaView>
      {abas.length > 1 ? (
        <BarraDeAbas
          abas={abas}
          ativa={ativa}
          itensNoCarrinho={itensNoCarrinho}
          tema={config.theme}
          aoTocar={aoTocarAba}
        />
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1 },
  area: { flex: 1 },
});

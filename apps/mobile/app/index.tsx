/**
 * A única rota do app.
 *
 * As abas vêm da config remota — de duas a cinco, com rótulo, ícone e ordem
 * decididos no painel —, então não há como escrever um arquivo por aba antes de
 * existir a loja. O roteador de arquivos cuida da abertura e dos links; quem
 * desenha as abas é `Loja`, em `src/telas/loja.tsx`.
 */
import { SplashScreen } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { useConfig } from '../src/nucleo/estado';
import { TelaDeAtualizacao, TelaDeCarregamento, TelaSemConfig } from '../src/telas/avisos';
import { Loja } from '../src/telas/loja';
import type { ContextoDoApp } from '../src/webview/scripts';

/**
 * Teto para a splash.
 *
 * A loja pode demorar; a splash não pode. Passados quatro segundos o app mostra
 * o que tem — barra de abas e a WebView carregando —, que é melhor do que uma
 * tela parada sem explicação.
 */
const LIMITE_DA_SPLASH_MS = 4000;

export default function Inicio(): React.ReactNode {
  const { estado, ambiente, recursos, recarregar } = useConfig();
  const splashEscondida = useRef(false);

  const esconderSplash = useCallback((): void => {
    if (splashEscondida.current) return;
    splashEscondida.current = true;
    void SplashScreen.hideAsync();
  }, []);

  // Teto de tempo: vale para qualquer estado, inclusive o de erro.
  useEffect(() => {
    const alarme = setTimeout(esconderSplash, LIMITE_DA_SPLASH_MS);
    return () => {
      clearTimeout(alarme);
    };
  }, [esconderSplash]);

  // Telas de aviso não esperam página nenhuma: aparecem assim que decididas.
  useEffect(() => {
    if (estado.estado === 'precisa-atualizar' || estado.estado === 'sem-config') esconderSplash();
  }, [esconderSplash, estado.estado]);

  const contextoDoApp = useMemo<ContextoDoApp>(
    () => ({
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      appVersion: ambiente.appVersion,
      // Na Fase 1 ainda não há push; a página precisa saber disso para não
      // oferecer um botão de avisos que não faria nada.
      pushEnabled: false,
    }),
    [ambiente.appVersion],
  );

  const contextoDasAcoes = useMemo(
    () => ({
      push: recursos.push,
      eventos: recursos.eventos,
      pedirAvaliacao: estado.estado === 'pronta' ? estado.config.features.rateAppPrompt : false,
    }),
    [estado, recursos.eventos, recursos.push],
  );

  switch (estado.estado) {
    case 'carregando':
      return <TelaDeCarregamento />;

    case 'precisa-atualizar':
      return <TelaDeAtualizacao />;

    case 'sem-config':
      return <TelaSemConfig motivo={estado.motivo} aoTentarDeNovo={recarregar} />;

    case 'pronta':
      return (
        <Loja
          config={estado.config}
          contextoDoApp={contextoDoApp}
          contextoDasAcoes={contextoDasAcoes}
          aoFicarPronto={esconderSplash}
        />
      );
  }
}

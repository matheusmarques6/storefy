/**
 * A única rota do app.
 *
 * As abas vêm da config remota — de duas a cinco, com rótulo, ícone e ordem
 * decididos no painel —, então não há como escrever um arquivo por aba antes de
 * existir a loja. O roteador de arquivos cuida da abertura e dos links; quem
 * desenha as abas é `Loja`, em `src/telas/loja.tsx`.
 */
import { SplashScreen } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { leuOnboarding, marcarOnboardingVisto } from '../src/config/fontes';
import { useConfig } from '../src/nucleo/estado';
import { estadoDoOnboarding } from '../src/nucleo/onboarding';
import { TelaDeAtualizacao, TelaDeCarregamento, TelaSemConfig } from '../src/telas/avisos';
import { Loja } from '../src/telas/loja';
import { Onboarding } from '../src/telas/onboarding';
import { TelaDePrevia } from '../src/telas/previa';
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
  const { estado, ambiente, recursos, recarregar, abrirPrevia } = useConfig();
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

  /*
   * Onboarding: os slides aparecem uma vez só, antes da loja. A leitura do
   * disco começa aqui e, enquanto não volta, `estadoDoOnboarding` devolve
   * `lendo` — sem isso a loja apareceria e os slides entrariam por cima dela.
   */
  const [jaViuOnboarding, setJaViuOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelado = false;
    const foiCancelado = (): boolean => cancelado;
    void leuOnboarding().then((visto) => {
      if (!foiCancelado()) setJaViuOnboarding(visto);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  const fecharOnboarding = useCallback((): void => {
    setJaViuOnboarding(true);
    void marcarOnboardingVisto();
  }, []);

  const onboarding =
    estado.estado === 'pronta'
      ? estadoDoOnboarding(estado.config.features.onboardingSlides, jaViuOnboarding)
      : 'pular';

  /*
   * Telas que não esperam página nenhuma: aparecem assim que decididas. Os
   * slides entram aqui porque são a primeira tela de verdade do app — segurar
   * a splash até a loja carregar deixaria o cliente olhando para nada.
   */
  useEffect(() => {
    if (
      estado.estado === 'precisa-atualizar' ||
      estado.estado === 'sem-config' ||
      estado.estado === 'sem-previa' ||
      onboarding === 'mostrar'
    ) {
      esconderSplash();
    }
  }, [esconderSplash, estado.estado, onboarding]);

  const contextoDoApp = useMemo<ContextoDoApp>(
    () => ({
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      appVersion: ambiente.appVersion,
      // O push chega na Fase 3. A página precisa saber disso para não oferecer
      // um botão de avisos que não faria nada.
      pushEnabled: recursos.push,
    }),
    [ambiente.appVersion, recursos.push],
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

    case 'sem-previa':
      return (
        <TelaDePrevia
          motivo={estado.motivo}
          aoInformarCodigo={(entrada) => {
            void abrirPrevia(entrada);
          }}
        />
      );

    case 'pronta':
      if (onboarding === 'lendo') return <TelaDeCarregamento cores={estado.config.theme} />;
      if (onboarding === 'mostrar') {
        return <Onboarding config={estado.config} aoTerminar={fecharOnboarding} />;
      }
      return (
        <Loja
          config={estado.config}
          ambiente={ambiente}
          contextoDoApp={contextoDoApp}
          contextoDasAcoes={contextoDasAcoes}
          aoFicarPronto={esconderSplash}
        />
      );
  }
}

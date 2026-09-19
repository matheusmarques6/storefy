/**
 * A barra fina de progresso no topo da WebView (seção 5.4 do plano).
 *
 * Existe porque a página da loja demora o que demora, e sem nenhum sinal o
 * toque parece não ter funcionado. Some sozinha ao chegar ao fim: uma barra
 * parada em 100% é ruído.
 */
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';

export function BarraDeProgresso({ valor, cor }: { valor: number; cor: string }): React.ReactNode {
  const largura = useRef(new Animated.Value(0)).current;
  const opacidade = useRef(new Animated.Value(0)).current;
  const completo = valor >= 1;

  useEffect(() => {
    Animated.timing(largura, {
      toValue: Math.max(0, Math.min(1, valor)),
      duration: 180,
      // Largura em porcentagem não roda na thread de animação.
      useNativeDriver: false,
    }).start();
  }, [largura, valor]);

  useEffect(() => {
    Animated.timing(opacidade, {
      toValue: completo ? 0 : 1,
      duration: completo ? 250 : 80,
      useNativeDriver: true,
    }).start();
  }, [completo, opacidade]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        estilos.barra,
        {
          backgroundColor: cor,
          opacity: opacidade,
          width: largura.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        },
      ]}
    />
  );
}

const estilos = StyleSheet.create({
  barra: { position: 'absolute', top: 0, left: 0, height: 2 },
});

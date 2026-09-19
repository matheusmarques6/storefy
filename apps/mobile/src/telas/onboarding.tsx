/**
 * Onboarding nativo (passo 3 da seção 5.3, item da checklist 5.7).
 *
 * Aparece uma vez só, no primeiro uso, e só quando a loja configurou slides.
 * Conta muito na revisão da Apple: é um dos recursos nativos que diferenciam o
 * app de um site embrulhado.
 *
 * Tem "Pular" desde o primeiro slide. Prender o cliente numa sequência que ele
 * não pediu, logo depois de instalar, é o caminho mais curto para a
 * desinstalação.
 */
import { useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AppConfig } from '@storefy/config-schema';

interface Props {
  config: AppConfig;
  aoTerminar: () => void;
}

export function Onboarding({ config, aoTerminar }: Props): React.ReactNode {
  const slides = config.features.onboardingSlides;
  const tema = config.theme;
  const rolagem = useRef<ScrollView>(null);
  const [atual, setAtual] = useState(0);
  const largura = Dimensions.get('window').width;
  const ultimo = atual >= slides.length - 1;

  function aoRolar(evento: NativeSyntheticEvent<NativeScrollEvent>): void {
    const indice = Math.round(evento.nativeEvent.contentOffset.x / largura);
    setAtual(Math.max(0, Math.min(slides.length - 1, indice)));
  }

  function avancar(): void {
    if (ultimo) {
      aoTerminar();
      return;
    }
    const proximo = atual + 1;
    rolagem.current?.scrollTo({ x: proximo * largura, animated: true });
    setAtual(proximo);
  }

  return (
    <View style={[estilos.tela, { backgroundColor: tema.background }]}>
      <SafeAreaView style={estilos.tela} edges={['top', 'bottom']}>
        <View style={estilos.topo}>
          <Pressable accessibilityRole="button" onPress={aoTerminar} hitSlop={12}>
            <Text style={[estilos.pular, { color: tema.text }]}>Pular</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={rolagem}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={aoRolar}
          style={estilos.tela}
        >
          {slides.map((slide, indice) => (
            <View
              key={`${slide.title}:${String(indice)}`}
              style={[estilos.slide, { width: largura }]}
            >
              {slide.image === '' ? null : (
                <Image
                  accessibilityIgnoresInvertColors
                  source={{ uri: slide.image }}
                  style={estilos.imagem}
                  resizeMode="contain"
                />
              )}
              <Text style={[estilos.titulo, { color: tema.text }]}>{slide.title}</Text>
              <Text style={[estilos.corpo, { color: tema.text }]}>{slide.body}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={estilos.rodape}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={estilos.pontos}
          >
            {slides.map((slide, indice) => (
              <View
                key={`ponto:${slide.title}:${String(indice)}`}
                style={[
                  estilos.ponto,
                  {
                    backgroundColor: indice === atual ? tema.primary : tema.tabBarInactive,
                    width: indice === atual ? 20 : 8,
                  },
                ]}
              />
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={avancar}
            style={({ pressed }) => [
              estilos.botao,
              { backgroundColor: tema.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[estilos.rotulo, { color: tema.background }]}>
              {ultimo ? 'Começar' : 'Continuar'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1 },
  topo: { alignItems: 'flex-end', paddingHorizontal: 20, paddingVertical: 12 },
  pular: { fontSize: 15, fontWeight: '500', opacity: 0.6 },
  slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  imagem: { width: '80%', height: 240, marginBottom: 12 },
  titulo: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  corpo: { fontSize: 16, lineHeight: 24, opacity: 0.7, textAlign: 'center' },
  rodape: { paddingHorizontal: 32, paddingBottom: 12, gap: 24 },
  pontos: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  ponto: { height: 8, borderRadius: 4 },
  botao: { paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  rotulo: { fontSize: 16, fontWeight: '600' },
});

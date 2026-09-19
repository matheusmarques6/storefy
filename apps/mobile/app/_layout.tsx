/**
 * Raiz do app (seção 5.3 do plano).
 *
 * A splash nativa fica de pé até a primeira página da loja carregar, ou até
 * quatro segundos — o que vier primeiro. Sem esse teto, uma loja lenta deixaria
 * o cliente olhando a splash sem saber se o app travou.
 */
import { SplashScreen, Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProvedorDaConfig } from '../src/nucleo/estado';

// Segura a splash antes de qualquer render. Fora do componente de propósito:
// dentro, o primeiro quadro já teria passado.
void SplashScreen.preventAutoHideAsync();

export default function Raiz(): React.ReactNode {
  return (
    <SafeAreaProvider>
      <ProvedorDaConfig>
        <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
      </ProvedorDaConfig>
    </SafeAreaProvider>
  );
}

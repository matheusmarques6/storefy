/**
 * O onboarding aparece agora? (passo 3 da seção 5.3 do plano)
 *
 * A decisão é separada da tela porque ela tem um detalhe que se erra fácil: ler
 * o disco leva alguns quadros, e mostrar a loja enquanto a resposta não chega
 * faria os slides piscarem por cima dela depois. Por isso existe o estado
 * `lendo` — e por isso, quando a loja não configurou slide nenhum, nem se
 * espera o disco.
 */
import type { AppConfig } from '@storefy/config-schema';

export type EstadoDoOnboarding =
  /** Ainda não se sabe se o cliente já viu. Não desenhe nada. */
  'lendo' | 'mostrar' | 'pular';

export function estadoDoOnboarding(
  slides: AppConfig['features']['onboardingSlides'],
  /** `null` enquanto a leitura do disco não voltou. */
  jaViu: boolean | null,
): EstadoDoOnboarding {
  if (slides.length === 0) return 'pular';
  if (jaViu === null) return 'lendo';
  return jaViu ? 'pular' : 'mostrar';
}

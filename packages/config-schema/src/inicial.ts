/**
 * A primeira `AppConfig` de uma loja (seção 4 do plano, fase 2).
 *
 * Toda loja nasce com um rascunho válido, e não com um objeto vazio esperando o
 * lojista preencher. Dois motivos:
 *
 *   - o editor precisa de algo para editar, e uma tela de formulário em branco
 *     com cinco seções é o jeito mais rápido de fazer alguém desistir;
 *   - o app precisa de algo para abrir. Config pela metade não passa no schema e
 *     é descartada, então "meio preenchida" é o mesmo que "nenhuma".
 *
 * O que sai daqui é um app que JÁ FUNCIONA: abre a loja, tem carrinho, busca e
 * conta. O lojista troca cor, ícone e nome de aba depois, no editor, e cada
 * mudança dele é uma melhora sobre algo que já funcionava.
 *
 * NADA AQUI É INVENTADO SOBRE A LOJA. Nome e endereço vêm do cadastro; cores
 * são um cinza neutro declarado como padrão, não um chute sobre a marca de
 * ninguém. A detecção automática (C03) substitui isso pelas cores reais do site.
 */
import { parseAppConfig, type AppConfig, type AppConfigInput } from './index';

/** Tema neutro de partida. Alto contraste, sem opinião sobre a marca. */
export const TEMA_PADRAO: AppConfigInput['theme'] = {
  primary: '#111827',
  background: '#ffffff',
  text: '#111827',
  tabBarBg: '#ffffff',
  tabBarActive: '#111827',
  tabBarInactive: '#9ca3af',
  statusBar: 'dark',
};

/**
 * As quatro abas com que todo app começa.
 *
 * Início, Buscar, Carrinho e Conta é o conjunto que qualquer loja tem — e é o
 * que a diretriz 4.2 da Apple espera ver numa tab bar de verdade. Cinco seria o
 * máximo e já fica apertado no iPhone pequeno; duas pareceriam um site.
 */
export const ABAS_PADRAO: AppConfigInput['tabs'] = [
  { id: 'inicio', label: 'Início', icon: 'house', type: 'webview', url: '/' },
  { id: 'busca', label: 'Buscar', icon: 'search', type: 'search' },
  { id: 'carrinho', label: 'Carrinho', icon: 'shopping-bag', type: 'cart', badge: 'cart_count' },
  { id: 'conta', label: 'Conta', icon: 'user', type: 'account' },
];

/**
 * Domínios que abrem DENTRO do app, a partir do endereço da loja.
 *
 * O `www.` é removido de propósito: a comparação do bridge é por limite de
 * ponto, então `loja.com.br` já cobre `www.loja.com.br` e qualquer subdomínio.
 * Listar os dois só faria a lista crescer sem cobrir nada a mais.
 *
 * O domínio `.myshopify.com` entra quando conhecido: várias lojas redirecionam
 * para ele em login e em alguns apps de terceiro, e sem ele o cliente sairia do
 * app no meio do fluxo.
 */
export function dominiosDaLoja(url: string, shopDomain?: string | null): string[] {
  const dominios: string[] = [];

  const principal = hostLimpo(url);
  if (principal !== null) dominios.push(principal);

  const shopify = hostLimpo(shopDomain ?? '');
  if (shopify !== null && !dominios.includes(shopify)) dominios.push(shopify);

  return dominios;
}

/** Host em minúsculas, sem `www.` e sem porta. `null` quando não dá para ler. */
function hostLimpo(entrada: string): string | null {
  const bruta = entrada.trim();
  if (bruta === '') return null;
  try {
    const url = new URL(bruta.includes('://') ? bruta : `https://${bruta}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host === '' ? null : host;
  } catch {
    return null;
  }
}

export interface DadosDaLoja {
  /** Nome que o lojista cadastrou. Aparece na tela e na loja de aplicativos. */
  name: string;
  /** URL pública, como está em `stores.primary_url`. */
  url: string;
  /** `stores.shop_domain`, quando a loja é Shopify. */
  shopDomain?: string | null;
  /** `stores.platform`. Sem ele, a config nasce como Shopify. */
  platform?: 'shopify' | 'other';
}

/**
 * Monta a config inicial de uma loja.
 *
 * Passa pelo `parseAppConfig` antes de devolver: se um dia um campo novo entrar
 * sem default, isto quebra aqui, no teste, e não na hora de gravar no banco.
 */
export function configInicial(loja: DadosDaLoja, versao = 1): AppConfig {
  return parseAppConfig({
    version: versao,
    store: {
      name: loja.name.trim(),
      url: loja.url.trim(),
      domains: dominiosDaLoja(loja.url, loja.shopDomain),
      platform: loja.platform ?? 'shopify',
    },
    theme: TEMA_PADRAO,
    tabs: ABAS_PADRAO,
    webview: {
      // Vazio de propósito: esconder o cabeçalho errado quebra a navegação da
      // loja. Quem escolhe é o lojista, no seletor visual do editor (C06).
      hideSelectors: [],
    },
    features: {
      pushPromptTiming: 'onboarding',
      onboardingSlides: [],
      appBanner: { enabled: false, text: '' },
    },
  } satisfies AppConfigInput);
}

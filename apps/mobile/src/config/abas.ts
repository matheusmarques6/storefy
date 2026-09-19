/**
 * Abas nativas derivadas da `AppConfig` (seções 5.3 e 5.4 do plano).
 *
 * Cada aba do tipo `webview` ganha a PRÓPRIA instância de WebView, mantida
 * viva enquanto o app existe. É o que torna a troca de aba instantânea e
 * preserva a rolagem — recarregar a página a cada toque é o que mais denuncia
 * um site embrulhado em app.
 */
import type { AppConfig, Tab } from '@storefy/config-schema';

/** Caminho padrão de cada tipo de aba na Shopify. */
const CAMINHO_PADRAO: Record<Tab['type'], string | null> = {
  webview: '/',
  cart: '/cart',
  account: '/account',
  search: '/search',
  // A caixa de avisos é tela nativa, não WebView: é um dos recursos que a
  // diretriz 4.2 da Apple espera ver num app que espelha um site.
  notifications: null,
};

export interface AbaResolvida {
  id: string;
  label: string;
  icone: string;
  tipo: Tab['type'];
  /** Badge exibido sobre o ícone. */
  badge: Tab['badge'];
  /** URL absoluta que a WebView abre. Null quando a aba é nativa. */
  url: string | null;
  /** Precisa de uma WebView própria e persistente? */
  webview: boolean;
}

/**
 * Resolve o caminho de uma aba para URL absoluta na loja.
 *
 * Um caminho absoluto apontando para fora da loja é RECUSADO: viraria uma aba
 * que abre outro site dentro do app, e o roteador de links não é consultado na
 * carga inicial de cada aba.
 */
export function urlDaAba(aba: Tab, base: string): string | null {
  const padrao = CAMINHO_PADRAO[aba.type];
  if (padrao === null) return null;

  const caminho = aba.type === 'webview' ? (aba.url ?? padrao) : (aba.url ?? padrao);

  let resolvida: URL;
  let raiz: URL;
  try {
    raiz = new URL(base);
    resolvida = new URL(caminho, base);
  } catch {
    return null;
  }

  if (resolvida.hostname !== raiz.hostname) return null;
  if (resolvida.protocol !== 'http:' && resolvida.protocol !== 'https:') return null;

  return resolvida.toString();
}

/** Lista final de abas que o `(tabs)/_layout` monta. */
export function resolverAbas(config: AppConfig): AbaResolvida[] {
  return config.tabs.map((aba) => {
    const url = urlDaAba(aba, config.store.url);
    return {
      id: aba.id,
      label: aba.label,
      icone: aba.icon,
      tipo: aba.type,
      badge: aba.badge,
      url,
      // `notifications` é nativa. As demais precisam de WebView, inclusive
      // `search`, cujo campo é nativo mas cujo resultado é a página da loja.
      webview: url !== null,
    };
  });
}

/** A aba que mostra a quantidade de itens do carrinho, se houver. */
export function abaDoCarrinho(abas: readonly AbaResolvida[]): AbaResolvida | null {
  return abas.find((aba) => aba.badge === 'cart_count') ?? null;
}

/**
 * Para onde um deep link de push deve levar.
 *
 * Devolve a aba cuja URL melhor cobre o caminho, e o próprio caminho para a
 * WebView navegar. Sem aba correspondente, cai na primeira — é melhor abrir o
 * produto na aba errada do que não abrir.
 */
export function abaParaCaminho(
  abas: readonly AbaResolvida[],
  caminho: string,
): { aba: AbaResolvida; caminho: string } | null {
  const primeira = abas[0];
  if (primeira === undefined) return null;

  const alvo = caminho.startsWith('/') ? caminho : `/${caminho}`;

  const comWebview = abas.filter((aba) => aba.webview && aba.url !== null);

  // A aba mais específica que cobre o caminho vence: `/account/orders` deve
  // abrir na aba de conta, não na inicial.
  const candidatas = comWebview
    .map((aba) => ({ aba, prefixo: new URL(aba.url ?? '').pathname }))
    .filter(({ prefixo }) => prefixo !== '/' && alvo.startsWith(prefixo))
    .sort((a, b) => b.prefixo.length - a.prefixo.length);

  const escolhida = candidatas[0]?.aba ?? comWebview[0] ?? primeira;
  return { aba: escolhida, caminho: alvo };
}

/**
 * As abas que ESTE build consegue servir.
 *
 * A caixa de avisos é tela nativa alimentada pelo push. Num build sem OneSignal
 * ela seria uma aba que abre em nada — e uma tela "em breve" é o que a regra 3
 * do CLAUDE.md proíbe. Melhor a aba não existir: o lojista vê o motivo no
 * painel, e o cliente nunca toca num lugar vazio.
 *
 * Se a filtragem não deixar nada de pé, a lista original volta: barra de abas
 * vazia é pior que uma aba que não funciona.
 */
export function abasUsaveis(
  abas: readonly AbaResolvida[],
  recursos: { push: boolean },
): AbaResolvida[] {
  const servem = abas.filter(
    (aba) => aba.webview || (aba.tipo === 'notifications' && recursos.push),
  );
  return servem.length === 0 ? [...abas] : servem;
}

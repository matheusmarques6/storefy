/**
 * Para onde vai cada link tocado dentro da WebView (seção 5.4 do plano).
 *
 * Três destinos:
 *
 *   webview  — navega na mesma aba. Domínios da loja e o checkout.
 *   externo  — sai do app pelo `Linking`. WhatsApp, Instagram, tel:, mailto:.
 *   bloquear — nem uma coisa nem outra. Esquemas que só servem para ataque.
 *
 * O CHECKOUT FICA NA MESMA WEBVIEW de propósito. Mandá-lo para o navegador
 * externo perderia os cookies de sessão, e o cliente chegaria ao pagamento com
 * o carrinho vazio. É o erro mais caro que este arquivo existe para evitar.
 */

export type DestinoDoLink =
  | { destino: 'webview' }
  | { destino: 'externo'; url: string }
  | { destino: 'bloquear'; motivo: string };

/**
 * Esquemas que nunca são abertos.
 *
 * `javascript:` e `data:` num link são vetor de injeção e de phishing: a
 * página da loja não é nossa — roda tema, apps e scripts de terceiros — e
 * qualquer um deles pode montar um link desses.
 */
const ESQUEMAS_BLOQUEADOS = new Set(['javascript:', 'data:', 'blob:', 'file:', 'vbscript:']);

/** Esquemas que o sistema operacional resolve melhor que nós. */
const ESQUEMAS_EXTERNOS = new Set([
  'tel:',
  'mailto:',
  'sms:',
  'whatsapp:',
  'intent:',
  'market:',
  'itms-apps:',
  'geo:',
  'facetime:',
]);

/** Caminhos e hosts do checkout da Shopify. */
const MARCAS_DE_CHECKOUT = ['/checkouts/', '/checkout'];
const HOSTS_DE_CHECKOUT = ['checkout.shopify.com', 'shop.app', 'shopifycs.com'];

/**
 * `alvo` pertence a `base`, ou é subdomínio dela?
 *
 * A comparação é por limite de ponto. Sem isso, `minha-loja.com.br.evil.com`
 * e `evilminha-loja.com.br` passariam por um `endsWith` ingênuo — que é
 * exatamente como se faz phishing em cima de uma lista de domínios.
 */
export function mesmoDominio(alvo: string, base: string): boolean {
  const a = normalizarHost(alvo);
  const b = normalizarHost(base);
  if (a === '' || b === '') return false;
  return a === b || a.endsWith(`.${b}`);
}

/** Minúsculas, sem `www.` e sem ponto final. */
function normalizarHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

/** O host de uma entrada da lista `domains`, que pode vir como URL ou domínio. */
function hostDaEntrada(entrada: string): string {
  const limpa = entrada.trim();
  if (limpa === '') return '';
  try {
    return normalizarHost(new URL(limpa.includes('://') ? limpa : `https://${limpa}`).hostname);
  } catch {
    return '';
  }
}

export interface ContextoDoLink {
  /** URL atual da WebView, para resolver links relativos. */
  urlAtual: string;
  /** `store.domains` da AppConfig: o que abre dentro do app. */
  dominios: readonly string[];
}

/**
 * Decide o destino de uma navegação.
 *
 * Recebe a URL como a WebView entrega em `onShouldStartLoadWithRequest`, que
 * pode ser relativa, absoluta, ou um esquema qualquer.
 */
export function destinoDoLink(url: string, contexto: ContextoDoLink): DestinoDoLink {
  const bruta = url.trim();
  if (bruta === '') return { destino: 'bloquear', motivo: 'URL vazia.' };

  const esquema = /^([a-z][a-z0-9+.-]*:)/i.exec(bruta)?.[1]?.toLowerCase();

  if (esquema != null && ESQUEMAS_BLOQUEADOS.has(esquema)) {
    return { destino: 'bloquear', motivo: `Esquema não permitido: ${esquema}` };
  }
  if (esquema != null && ESQUEMAS_EXTERNOS.has(esquema)) {
    return { destino: 'externo', url: bruta };
  }

  // `about:blank` aparece em iframe e em window.open; não é navegação de verdade.
  if (bruta.toLowerCase().startsWith('about:')) {
    return { destino: 'bloquear', motivo: 'Navegação interna do navegador.' };
  }

  let resolvida: URL;
  try {
    resolvida = new URL(bruta, contexto.urlAtual);
  } catch {
    return { destino: 'bloquear', motivo: 'URL inválida.' };
  }

  // Depois de resolver, só http(s) continua. Um esquema exótico que tenha
  // escapado das listas acima para aqui.
  if (resolvida.protocol !== 'http:' && resolvida.protocol !== 'https:') {
    return { destino: 'bloquear', motivo: `Esquema não permitido: ${resolvida.protocol}` };
  }

  // O checkout vem antes da lista de domínios: ele roda em host da Shopify,
  // que o lojista não teria por que listar, e precisa ficar na mesma WebView.
  if (ehCheckout(resolvida)) return { destino: 'webview' };

  const permitidos = [
    hostDaEntrada(contexto.urlAtual),
    ...contexto.dominios.map(hostDaEntrada),
  ].filter((host) => host !== '');

  if (permitidos.some((base) => mesmoDominio(resolvida.hostname, base))) {
    return { destino: 'webview' };
  }

  return { destino: 'externo', url: resolvida.toString() };
}

/** A URL é uma etapa do checkout? */
export function ehCheckout(url: URL): boolean {
  const host = normalizarHost(url.hostname);
  if (HOSTS_DE_CHECKOUT.some((base) => mesmoDominio(host, base))) return true;

  const caminho = url.pathname.toLowerCase();
  return MARCAS_DE_CHECKOUT.some(
    (marca) => caminho.startsWith(marca) || caminho.includes(`${marca}/`) || caminho === marca,
  );
}

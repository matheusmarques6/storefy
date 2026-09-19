/**
 * O que dá para descobrir sozinho sobre a loja (C02–C04 do plano).
 *
 * O lojista digita o endereço e o painel já sabe o nome, a cor da marca e o
 * logo. É a diferença entre um cadastro de quinze campos e um de um campo.
 *
 * TUDO AQUI É LEITURA DO SITE DELE, e nada é inventado: quando uma informação
 * não está na página, o campo volta vazio e a tela pede para preencher. Um
 * "nome provável" chutado a partir do domínio apareceria como certeza e o
 * lojista publicaria o app com ele sem perceber (regra 1).
 *
 * A análise é de texto puro, sem DOM: roda no servidor, entra em teste sem
 * navegador e não depende de a página ser HTML bem formado — e tema de loja
 * raramente é.
 */

export interface MarcaDetectada {
  /** Nome da loja, como o site se apresenta. */
  nome: string | null;
  /** Cor da marca, em hexadecimal, quando o site declara uma. */
  corPrincipal: string | null;
  /** Endereço absoluto do logo ou do ícone. */
  logo: string | null;
  /** Descrição curta, para a ficha da loja de aplicativos. */
  descricao: string | null;
  /** A página tem marcas de Shopify? */
  ehShopify: boolean;
}

/** Lê o conteúdo de uma metatag, por nome ou por propriedade. */
function meta(html: string, chave: string): string | null {
  const escapada = chave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const padroes = [
    new RegExp(
      `<meta[^>]+(?:name|property)\\s*=\\s*["']${escapada}["'][^>]*?content\\s*=\\s*["']([^"']*)["']`,
      'i',
    ),
    new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*?(?:name|property)\\s*=\\s*["']${escapada}["']`,
      'i',
    ),
  ];
  for (const padrao of padroes) {
    const achado = padrao.exec(html)?.[1];
    if (achado !== undefined && achado.trim() !== '') return decodificar(achado.trim());
  }
  return null;
}

/** Lê o `href` de um `<link rel="...">`. */
function link(html: string, rel: string): string | null {
  const escapada = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const padroes = [
    new RegExp(
      `<link[^>]+rel\\s*=\\s*["'][^"']*${escapada}[^"']*["'][^>]*?href\\s*=\\s*["']([^"']+)["']`,
      'i',
    ),
    new RegExp(
      `<link[^>]+href\\s*=\\s*["']([^"']+)["'][^>]*?rel\\s*=\\s*["'][^"']*${escapada}[^"']*["']`,
      'i',
    ),
  ];
  for (const padrao of padroes) {
    const achado = padrao.exec(html)?.[1];
    if (achado !== undefined && achado.trim() !== '') return decodificar(achado.trim());
  }
  return null;
}

/** As entidades que aparecem de verdade em título de loja. */
function decodificar(texto: string): string {
  return texto
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

/**
 * O nome da loja a partir do `<title>`.
 *
 * Tema de Shopify quase sempre escreve "Nome da loja – Descrição" ou
 * "Produto | Nome da loja". Ficar com a linha inteira poria a frase de efeito
 * do tema no nome do app, que tem 30 caracteres na App Store.
 */
export function nomeDoTitulo(titulo: string): string | null {
  const limpo = decodificar(titulo);
  if (limpo === '') return null;

  const partes = limpo
    .split(/\s+[–—|·]\s+|\s+-\s+/)
    .map((parte) => parte.trim())
    .filter((parte) => parte !== '');

  if (partes.length === 0) return null;
  // A primeira parte é o nome na esmagadora maioria dos temas.
  const escolhida = partes[0] ?? limpo;

  // Título só com pontuação — `" | "`, `"---"` — não é nome de loja, e
  // colocá-lo no campo faria o lojista publicar um app chamado "|".
  if (!/[\p{L}\p{N}]/u.test(escolhida)) return null;

  return escolhida.length > 60 ? escolhida.slice(0, 60).trim() : escolhida;
}

/** Normaliza uma cor declarada pelo site para o formato que o app aceita. */
export function corNormalizada(valor: string | null): string | null {
  if (valor === null) return null;
  const limpo = valor.trim().toLowerCase();

  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(limpo)) return limpo;
  if (/^#[0-9a-f]{8}$/.test(limpo)) return limpo.slice(0, 7);

  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/.exec(limpo);
  if (rgb !== null) {
    const canais = rgb.slice(1, 4).map((parte) => Number.parseInt(parte, 10));
    if (canais.every((canal) => canal >= 0 && canal <= 255)) {
      return `#${canais.map((canal) => canal.toString(16).padStart(2, '0')).join('')}`;
    }
  }

  // Nome de cor CSS não é traduzido aqui de propósito: seria uma tabela de 140
  // linhas para cobrir um caso que praticamente não aparece em `theme-color`.
  return null;
}

/** Resolve um endereço relativo do site contra a URL da loja. */
function absoluta(valor: string | null, base: string): string | null {
  if (valor === null) return null;
  try {
    const url = new URL(valor, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** A página tem marca de Shopify? */
export function pareceShopify(html: string): boolean {
  return (
    /cdn\.shopify\.com/i.test(html) ||
    /\/cdn\/shop\//i.test(html) ||
    /Shopify\.shop\s*=/i.test(html) ||
    /var\s+Shopify\s*=/i.test(html) ||
    /shopify-features/i.test(html) ||
    /x-shopid/i.test(html)
  );
}

/** Lê tudo o que a página conta sobre a loja. */
export function detectarMarca(html: string, urlDaLoja: string): MarcaDetectada {
  const titulo = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';

  const nome =
    meta(html, 'og:site_name') ??
    meta(html, 'application-name') ??
    meta(html, 'apple-mobile-web-app-title') ??
    nomeDoTitulo(titulo);

  const logo =
    absoluta(link(html, 'apple-touch-icon'), urlDaLoja) ??
    absoluta(meta(html, 'og:logo'), urlDaLoja) ??
    absoluta(meta(html, 'og:image'), urlDaLoja) ??
    absoluta(link(html, 'icon'), urlDaLoja);

  return {
    nome: nome === null || nome === '' ? null : nome,
    corPrincipal: corNormalizada(
      meta(html, 'theme-color') ?? meta(html, 'msapplication-TileColor'),
    ),
    logo,
    descricao: meta(html, 'og:description') ?? meta(html, 'description'),
    ehShopify: pareceShopify(html),
  };
}

/**
 * Sugere um tema a partir da cor da marca.
 *
 * Só a cor principal e o destaque da aba ativa saem daqui; fundo e texto ficam
 * neutros. Pintar o fundo do app com a cor da marca costuma dar uma tela
 * ilegível, e é o tipo de escolha que só o lojista consegue fazer olhando.
 */
export function temaSugerido(corDaMarca: string | null): {
  primary: string;
  tabBarActive: string;
} | null {
  const cor = corNormalizada(corDaMarca);
  if (cor === null) return null;
  return { primary: cor, tabBarActive: cor };
}

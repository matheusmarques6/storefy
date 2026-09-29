import 'server-only';

/**
 * O logo do site, virado ícone do app (C03: "confirma logo").
 *
 * A detecção do cadastro já mostra o logo; aqui ele vira o ícone de verdade.
 * A página é relida (só o servidor alcança o site, e só por busca pública),
 * os candidatos a logo são tentados do mais provável para o menos, e o
 * primeiro que passa vira um ícone de 1024 px pelo `iconeDoLogo` — que o
 * `guardarAsset` confere de novo, com a mesma régua do ícone enviado à mão.
 */
import { ERROS_DO_LOGO, iconeDoLogo, type ProblemaDoLogo } from '@storefy/assets';
import { buscarPublico } from '@/lib/busca-publica';
import {
  AGENTE_DA_STOREFY,
  TEMPO_LIMITE_DA_LEITURA_MS,
  lerPaginaDaLoja,
} from '@/lib/pagina-da-loja';
import { TAMANHO_MAXIMO_DE_IMAGEM } from '@/lib/limites-de-imagem';

/** Quantos candidatos tentar. Cada um é um download. */
const MAXIMO_DE_CANDIDATOS = 5;

function decodificar(texto: string): string {
  return texto
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function atributo(tag: string, nome: string): string | null {
  const achado = new RegExp(`\\b${nome}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  return achado === undefined || achado.trim() === '' ? null : decodificar(achado.trim());
}

/** O maior lado declarado em `sizes="180x180"` (ou em `any`, que é vetor). */
function tamanhoDeclarado(tag: string): number {
  const sizes = atributo(tag, 'sizes');
  if (sizes === null) return 0;
  if (/\bany\b/i.test(sizes)) return 4096;
  const lados = [...sizes.matchAll(/(\d+)x(\d+)/gi)].map((m) =>
    Math.max(Number(m[1] ?? 0), Number(m[2] ?? 0)),
  );
  return lados.length === 0 ? 0 : Math.max(...lados);
}

/** A maior imagem de um `srcset`. */
function maiorDoSrcset(srcset: string): string | null {
  let melhor: { url: string; largura: number } | null = null;
  for (const parte of srcset.split(',')) {
    const [url, descritor = ''] = parte.trim().split(/\s+/);
    if (url === undefined || url === '') continue;
    const largura = Number.parseInt(descritor, 10) || 0;
    if (melhor === null || largura > melhor.largura) melhor = { url, largura };
  }
  return melhor?.url ?? null;
}

/**
 * O arquivo ORIGINAL de uma imagem do CDN da Shopify.
 *
 * O tema pede a imagem já reduzida (`?width=180`, `logo_180x.png`), e o CDN
 * entrega o tamanho pedido. Sem os parâmetros, ele entrega o arquivo que o
 * lojista enviou — em geral grande o bastante para um ícone nítido.
 */
export function urlOriginalDaShopify(endereco: string): string {
  let url: URL;
  try {
    url = new URL(endereco);
  } catch {
    return endereco;
  }
  const doCdn = url.hostname === 'cdn.shopify.com' || url.pathname.includes('/cdn/shop/');
  if (!doCdn) return endereco;

  for (const parametro of ['width', 'height', 'crop', 'pad_color', 'format']) {
    url.searchParams.delete(parametro);
  }
  url.pathname = url.pathname.replace(
    /_(?:\d+x\d*|x\d+|small|medium|large|grande|compact|pico|icon|thumb)(?:@\dx)?(\.[a-z]+)$/i,
    '$1',
  );
  return url.toString();
}

/**
 * Os lugares onde um site costuma declarar o logo, do mais provável para o
 * menos — e cada um no tamanho original, quando é do CDN da Shopify.
 */
export function candidatosDeLogo(html: string, base: string): string[] {
  const achados: { url: string; peso: number }[] = [];
  const guardar = (bruto: string | null, peso: number): void => {
    if (bruto === null) return;
    try {
      achados.push({ url: urlOriginalDaShopify(new URL(bruto, base).toString()), peso });
    } catch {
      /* Endereço que não se monta não é candidato. */
    }
  };

  // O logo do cabeçalho do tema (Dawn e derivados): é o desenho de verdade.
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const classe = atributo(tag, 'class') ?? '';
    if (!/(^|[\s_-])logo([\s_-]|$)/i.test(classe) && !/header__heading-logo/i.test(classe)) {
      continue;
    }
    const srcset = atributo(tag, 'srcset');
    guardar(srcset === null ? atributo(tag, 'src') : maiorDoSrcset(srcset), 100);
  }

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const nome = (atributo(tag, 'property') ?? atributo(tag, 'name') ?? '').toLowerCase();
    if (nome === 'og:logo') guardar(atributo(tag, 'content'), 90);
    if (nome === 'og:image') guardar(atributo(tag, 'content'), 10);
  }

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (atributo(tag, 'rel') ?? '').toLowerCase();
    const tamanho = tamanhoDeclarado(tag);
    if (rel.includes('apple-touch-icon')) guardar(atributo(tag, 'href'), 50 + tamanho / 100);
    else if (/\bicon\b/.test(rel)) guardar(atributo(tag, 'href'), 20 + tamanho / 100);
  }

  const vistos = new Set<string>();
  return achados
    .sort((a, b) => b.peso - a.peso)
    .map((achado) => achado.url)
    .filter((url) => {
      if (vistos.has(url)) return false;
      vistos.add(url);
      return true;
    });
}

export type IconeDoSite = { ok: true; icone: Buffer } | { ok: false; motivo: string };

/**
 * Relê o site, acha o logo e devolve o ícone pronto — ou o motivo, em pt-BR.
 *
 * `corDaMarca` é a cor principal do app: o fundo de um logo branco.
 */
export async function iconeDoSite(
  urlDaLoja: URL,
  corDaMarca: string | null,
  buscador?: typeof fetch,
): Promise<IconeDoSite> {
  const pagina = await lerPaginaDaLoja(urlDaLoja, buscador);
  if (!pagina.ok) return { ok: false, motivo: pagina.motivo };

  const candidatos = candidatosDeLogo(pagina.html, pagina.url.toString()).slice(
    0,
    MAXIMO_DE_CANDIDATOS,
  );
  if (candidatos.length === 0) {
    return {
      ok: false,
      motivo: 'Não achamos um logo na página inicial da loja. Envie o ícone à mão.',
    };
  }

  // O pior problema visto decide a mensagem: "pequeno" diz o que fazer.
  let problema: ProblemaDoLogo | null = null;
  for (const candidato of candidatos) {
    const imagem = await buscarPublico(new URL(candidato), {
      aceitar: 'image/*',
      tamanhoMaximo: TAMANHO_MAXIMO_DE_IMAGEM,
      tempoLimiteMs: TEMPO_LIMITE_DA_LEITURA_MS,
      agente: AGENTE_DA_STOREFY,
      ...(buscador === undefined ? {} : { buscador }),
    });
    if (!imagem.ok) continue;

    const resultado = await iconeDoLogo(Buffer.from(imagem.corpo), corDaMarca);
    if (resultado.ok) return { ok: true, icone: resultado.icone };
    if (problema === null || resultado.problema === 'pequeno') problema = resultado.problema;
  }

  return {
    ok: false,
    motivo:
      problema === null
        ? 'Não conseguimos baixar o logo do site agora. Tente de novo ou envie o ícone à mão.'
        : ERROS_DO_LOGO[problema],
  };
}

/**
 * A busca no catálogo, com a Shopify falsa e o token de verdade.
 *
 * O que se prova aqui é a LIGAÇÃO, e ela tem dois riscos: o token da loja
 * vazar para onde não deve, e a tela dizer "tente de novo" quando o certo é
 * "reconecte" — porque tentar de novo daria no mesmo para sempre.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criptografar } from '@/lib/cripto';
import { buscarNoCatalogo } from '@/lib/catalogo-servidor';

const CHAVE = Buffer.alloc(32, 7).toString('base64');
const LOJA = 'oak-vintage.myshopify.com';
const TOKEN = 'shpat_do_teste';

let chaveOriginal: string | undefined;

beforeEach(() => {
  chaveOriginal = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = CHAVE;
});

afterEach(() => {
  if (chaveOriginal === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = chaveOriginal;
});

interface LojaFalsa {
  shop_domain: string | null;
  shopify_access_token_enc: string | null;
}

function servicoFalso(loja: LojaFalsa | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: loja, error: null }),
        }),
      }),
    }),
  } as never;
}

const LOJA_CONECTADA = (): LojaFalsa => ({
  shop_domain: LOJA,
  shopify_access_token_enc: criptografar(TOKEN),
});

interface OpcoesDaRede {
  status?: number;
  produtos?: unknown;
  colecoes?: unknown;
  quebrar?: boolean;
}

/** O alvo como texto, seja qual for a forma que o fetch aceita. */
function urlDe(url: string | URL | Request): string {
  if (typeof url === 'string') return url;
  return url instanceof URL ? url.toString() : url.url;
}

function redeFalsa(opcoes: OpcoesDaRede = {}) {
  const chamadas: { url: string; token: string | null }[] = [];

  const buscador = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const alvo = urlDe(url);
    const cabecalhos = new Headers(init?.headers);
    chamadas.push({ url: alvo, token: cabecalhos.get('X-Shopify-Access-Token') });

    if (opcoes.quebrar === true) return Promise.reject(new Error('sem rede'));

    const corpo = alvo.includes('products.json')
      ? (opcoes.produtos ?? {
          products: [{ id: 1, title: 'Jaqueta', handle: 'jaqueta' }],
        })
      : (opcoes.colecoes ?? { custom_collections: [], smart_collections: [] });

    return Promise.resolve(
      new Response(JSON.stringify(corpo), {
        status: opcoes.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  return { buscador: buscador as unknown as typeof fetch, chamadas };
}

describe('buscarNoCatalogo', () => {
  it('busca produtos e coleções com o token da loja', async () => {
    const { buscador, chamadas } = redeFalsa();

    const resultado = await buscarNoCatalogo(
      servicoFalso(LOJA_CONECTADA()),
      'loja-1',
      'jaqueta',
      buscador,
    );

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.itens[0]?.caminho).toBe('/products/jaqueta');

    // Três chamadas: produtos, coleções manuais e coleções automáticas.
    expect(chamadas).toHaveLength(3);
    for (const chamada of chamadas) {
      expect(chamada.token).toBe(TOKEN);
      expect(new URL(chamada.url).host).toBe(LOJA);
    }
  });

  /*
   * Loja sem Shopify não é erro: é um estado, e a tela diz o que fazer. Sem
   * isso, o lojista veria "não conseguimos falar com a Shopify" e tentaria de
   * novo para sempre.
   */
  it('loja desconectada devolve o convite para conectar, sem chamar a rede', async () => {
    const { buscador, chamadas } = redeFalsa();

    const resultado = await buscarNoCatalogo(
      servicoFalso({ shop_domain: LOJA, shopify_access_token_enc: null }),
      'loja-1',
      '',
      buscador,
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.desconectada).toBe(true);
      expect(resultado.motivo).toContain('Conecte a Shopify');
    }
    expect(chamadas).toEqual([]);
  });

  it('domínio que não é de loja Shopify também não vira chamada', async () => {
    const { buscador, chamadas } = redeFalsa();

    const resultado = await buscarNoCatalogo(
      servicoFalso({ shop_domain: 'evil.com', shopify_access_token_enc: criptografar(TOKEN) }),
      'loja-1',
      '',
      buscador,
    );

    expect(resultado.ok).toBe(false);
    expect(chamadas).toEqual([]);
  });

  it('loja que não existe não estoura', async () => {
    const { buscador } = redeFalsa();

    expect((await buscarNoCatalogo(servicoFalso(null), 'loja-1', '', buscador)).ok).toBe(false);
  });

  /*
   * 401 é o token revogado: o lojista desinstalou o app na Shopify. "Tente de
   * novo" ali seria mentira — só reconectando.
   */
  it('token revogado manda reconectar, e não tentar de novo', async () => {
    const { buscador } = redeFalsa({ status: 401 });

    const resultado = await buscarNoCatalogo(
      servicoFalso(LOJA_CONECTADA()),
      'loja-1',
      '',
      buscador,
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.desconectada).toBe(true);
      expect(resultado.motivo).toContain('Reconecte');
    }
  });

  it('rede fora do ar vira "tente de novo", e não "reconecte"', async () => {
    const { buscador } = redeFalsa({ quebrar: true });

    const resultado = await buscarNoCatalogo(
      servicoFalso(LOJA_CONECTADA()),
      'loja-1',
      '',
      buscador,
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.desconectada).toBeUndefined();
      expect(resultado.motivo).toContain('Tente de novo');
    }
  });

  /* Chave de criptografia trocada: o token guardado não abre mais. */
  it('token que não abre manda reconectar', async () => {
    const loja = LOJA_CONECTADA();
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

    const { buscador, chamadas } = redeFalsa();
    const resultado = await buscarNoCatalogo(servicoFalso(loja), 'loja-1', '', buscador);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.desconectada).toBe(true);
    expect(chamadas).toEqual([]);
  });

  it('uma resposta ruim não derruba as outras', async () => {
    let chamada = 0;
    const buscador = vi.fn((url: string | URL | Request) => {
      chamada += 1;
      const corpo = urlDe(url).includes('products.json')
        ? { products: [{ id: 1, title: 'Jaqueta', handle: 'jaqueta' }] }
        : { custom_collections: [] };

      return Promise.resolve(
        new Response(JSON.stringify(corpo), { status: chamada === 2 ? 500 : 200 }),
      );
    });

    const resultado = await buscarNoCatalogo(
      servicoFalso(LOJA_CONECTADA()),
      'loja-1',
      '',
      buscador,
    );

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.itens).toHaveLength(1);
  });
});

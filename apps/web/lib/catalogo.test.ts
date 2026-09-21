import { describe, expect, it } from 'vitest';
import {
  LIMITE_DA_BUSCA,
  caminhoDoItem,
  lerItens,
  montarResultados,
  urlDeColecoes,
  urlDeProdutos,
} from '@/lib/catalogo';
import { VERSAO_DA_API } from '@/lib/shopify';

const LOJA = 'oak-vintage.myshopify.com';

describe('urlDeProdutos', () => {
  /*
   * `title` e não `q`: a Admin API REST filtra produto por título, e `q` seria
   * ignorado em silêncio — a busca pareceria quebrada só para quem digita algo
   * que não é o começo de um título.
   */
  it('busca por título, com limite e só produtos ativos', () => {
    const url = new URL(urlDeProdutos(LOJA, ' jaqueta '));

    expect(url.host).toBe(LOJA);
    expect(url.pathname).toBe(`/admin/api/${VERSAO_DA_API}/products.json`);
    expect(url.searchParams.get('title')).toBe('jaqueta');
    expect(url.searchParams.get('status')).toBe('active');
    expect(url.searchParams.get('limit')).toBe(String(LIMITE_DA_BUSCA));
  });

  /*
   * Sem termo a Shopify devolve os mais recentes — que é o que faz a lista
   * abrir cheia em vez de pedir ao lojista que adivinhe o nome exato.
   */
  it('sem termo, não manda filtro de título', () => {
    const url = new URL(urlDeProdutos(LOJA, '   '));

    expect(url.searchParams.has('title')).toBe(false);
  });

  /* O termo vem do que o lojista digitou e vira query string. */
  it('escapa o que foi digitado', () => {
    const url = new URL(urlDeProdutos(LOJA, 'a&b=c #1'));

    expect(url.searchParams.get('title')).toBe('a&b=c #1');
    expect(url.searchParams.get('limit')).toBe(String(LIMITE_DA_BUSCA));
  });
});

describe('urlDeColecoes', () => {
  /* A Shopify separa coleção manual de automática em recursos diferentes. */
  it('aponta para o recurso certo de cada tipo', () => {
    expect(new URL(urlDeColecoes(LOJA, false, '')).pathname).toBe(
      `/admin/api/${VERSAO_DA_API}/custom_collections.json`,
    );
    expect(new URL(urlDeColecoes(LOJA, true, '')).pathname).toBe(
      `/admin/api/${VERSAO_DA_API}/smart_collections.json`,
    );
  });
});

describe('lerItens', () => {
  it('lê os produtos com caminho e miniatura', () => {
    const itens = lerItens(
      {
        products: [
          {
            id: 12345,
            title: 'Jaqueta jeans',
            handle: 'jaqueta-jeans',
            image: { src: 'https://cdn.shopify.com/jaqueta.jpg' },
          },
        ],
      },
      'products',
      'produto',
    );

    expect(itens).toEqual([
      {
        tipo: 'produto',
        id: '12345',
        titulo: 'Jaqueta jeans',
        caminho: '/products/jaqueta-jeans',
        imagem: 'https://cdn.shopify.com/jaqueta.jpg',
      },
    ]);
  });

  /*
   * É o `handle` que vira o caminho. Um item sem ele só poderia virar um link
   * quebrado na notificação de alguém.
   */
  it('descarta item sem handle', () => {
    const itens = lerItens(
      {
        products: [
          { id: 1, title: 'Sem handle' },
          { id: 2, title: 'Vazio', handle: '  ' },
        ],
      },
      'products',
      'produto',
    );

    expect(itens).toEqual([]);
  });

  it('sem título, o handle vira o rótulo em vez de um item em branco', () => {
    const itens = lerItens({ products: [{ id: 1, handle: 'so-handle' }] }, 'products', 'produto');

    expect(itens[0]?.titulo).toBe('so-handle');
  });

  /*
   * A imagem vai para um `<img>` no painel, e a resposta é da loja do cliente
   * — que instalou os apps que quis. `javascript:` e `data:` não entram.
   */
  it('só aceita miniatura https', () => {
    for (const src of [
      'http://cdn.shopify.com/x.jpg',
      'javascript:alert(1)',
      'data:image/svg+xml;base64,AAAA',
      '//cdn.shopify.com/x.jpg',
      42,
    ]) {
      const itens = lerItens(
        { products: [{ id: 1, handle: 'x', image: { src } }] },
        'products',
        'produto',
      );
      expect(itens[0]?.imagem, String(src)).toBeNull();
    }
  });

  it('payload torto não estoura', () => {
    for (const corpo of [null, 'texto', {}, { products: 'não é lista' }, { products: [null, 7] }]) {
      expect(lerItens(corpo, 'products', 'produto'), JSON.stringify(corpo)).toEqual([]);
    }
  });
});

describe('caminhoDoItem', () => {
  it('usa o caminho que a Shopify serve', () => {
    expect(caminhoDoItem('produto', 'jaqueta')).toBe('/products/jaqueta');
    expect(caminhoDoItem('colecao', 'inverno')).toBe('/collections/inverno');
  });
});

describe('montarResultados', () => {
  function item(titulo: string, tipo: 'produto' | 'colecao' = 'produto') {
    return { tipo, id: titulo, titulo, caminho: `/x/${titulo}`, imagem: null };
  }

  /* Produto primeiro: é o que o lojista manda em nove de cada dez campanhas. */
  it('põe produto antes de coleção', () => {
    const itens = montarResultados([item('p1')], [item('c1', 'colecao')]);

    expect(itens.map((i) => i.titulo)).toEqual(['p1', 'c1']);
  });

  it('e tem teto, para a lista não virar rolagem infinita', () => {
    const muitos = Array.from({ length: 50 }, (_, i) => item(`p${String(i)}`));

    expect(montarResultados(muitos, muitos).length).toBeLessThanOrEqual(LIMITE_DA_BUSCA * 2);
  });
});

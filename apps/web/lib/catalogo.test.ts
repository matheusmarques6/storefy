import { describe, expect, it } from 'vitest';
import {
  LIMITE_DA_BUSCA,
  buscasDoCatalogo,
  caminhoDoItem,
  lerCatalogo,
  montarResultados,
} from '@/lib/catalogo';

describe('buscasDoCatalogo', () => {
  it('só produto ativo, e cada palavra acha o começo de uma palavra do título', () => {
    expect(buscasDoCatalogo('jaqueta azul')).toEqual({
      produtos: 'status:active title:jaqueta* title:azul*',
      colecoes: 'title:jaqueta* title:azul*',
    });
  });

  it('sem termo, todos os produtos ativos e todas as coleções', () => {
    expect(buscasDoCatalogo('   ')).toEqual({ produtos: 'status:active', colecoes: '' });
  });

  /*
   * O texto digitado não pode virar filtro: dois-pontos, aspas, parênteses e
   * o "-" do começo são operadores da busca da Shopify.
   */
  it('o que é operador da busca sai, e acento e hífen do meio ficam', () => {
    expect(buscasDoCatalogo('status:draft "vip" (x) -oculto camisa-polo ação').produtos).toBe(
      'status:active title:status* title:draft* title:vip* title:x* title:oculto*',
    );
    expect(buscasDoCatalogo('camisa-polo ação').colecoes).toBe('title:camisa-polo* title:ação*');
  });
});

describe('lerCatalogo', () => {
  it('lê produtos e coleções com caminho e miniatura, produto primeiro', () => {
    const itens = lerCatalogo({
      products: {
        nodes: [
          {
            id: 'gid://shopify/Product/1',
            title: 'Jaqueta',
            handle: 'jaqueta',
            featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/j.jpg' } } },
          },
        ],
      },
      collections: {
        nodes: [
          {
            id: 'gid://shopify/Collection/2',
            title: 'Inverno',
            handle: 'inverno',
            image: { url: 'https://cdn.shopify.com/i.jpg' },
          },
        ],
      },
    });

    expect(itens).toEqual([
      {
        tipo: 'produto',
        id: 'gid://shopify/Product/1',
        titulo: 'Jaqueta',
        caminho: '/products/jaqueta',
        imagem: 'https://cdn.shopify.com/j.jpg',
      },
      {
        tipo: 'colecao',
        id: 'gid://shopify/Collection/2',
        titulo: 'Inverno',
        caminho: '/collections/inverno',
        imagem: 'https://cdn.shopify.com/i.jpg',
      },
    ]);
  });

  /* Sem handle não há caminho: o item só viraria um link quebrado na notificação. */
  it('descarta item sem handle, e o sem título usa o handle', () => {
    const itens = lerCatalogo({
      products: {
        nodes: [
          { id: 'a', title: 'Sem handle' },
          { id: 'b', handle: 'so-handle' },
        ],
      },
    });

    expect(itens.map((item) => item.titulo)).toEqual(['so-handle']);
  });

  /* A miniatura vai para um <img> no painel: `javascript:` ou `data:` nunca. */
  it('só aceita miniatura https, e produto sem mídia fica sem miniatura', () => {
    const itens = lerCatalogo({
      products: {
        nodes: [
          {
            id: 'a',
            handle: 'a',
            featuredMedia: { preview: { image: { url: 'javascript:alert(1)' } } },
          },
          { id: 'b', handle: 'b', featuredMedia: null },
        ],
      },
      collections: { nodes: [{ id: 'c', handle: 'c', image: { url: 'data:image/png;base64,x' } }] },
    });

    expect(itens.map((item) => item.imagem)).toEqual([null, null, null]);
  });

  it('resposta torta não estoura', () => {
    expect(lerCatalogo({})).toEqual([]);
    expect(lerCatalogo({ products: 'x', collections: { nodes: 'y' } })).toEqual([]);
    expect(lerCatalogo({ products: { nodes: [null, 1, 'x'] } })).toEqual([]);
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

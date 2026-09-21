import { describe, expect, it } from 'vitest';
import {
  TOPICOS,
  TOPICOS_OBRIGATORIOS,
  ehDominioDeLoja,
  ehTopicoConhecido,
  faltamEscopos,
  normalizarDominio,
  urlDeAutorizacao,
  urlDoAdmin,
} from '@/lib/shopify';

describe('ehDominioDeLoja', () => {
  it('aceita um domínio de loja de verdade', () => {
    expect(ehDominioDeLoja('minha-loja.myshopify.com')).toBe(true);
    expect(ehDominioDeLoja('loja123.myshopify.com')).toBe(true);
  });

  /*
   * O `shop` chega pela URL e vira o HOST de uma chamada nossa. Sem este
   * crivo, `?shop=evil.com` faria o servidor mandar o segredo do app para onde
   * quem pediu escolheu — o caminho inteiro de um SSRF.
   */
  it('recusa qualquer coisa que não seja .myshopify.com', () => {
    for (const ruim of [
      'evil.com',
      'minha-loja.myshopify.com.evil.com',
      'evil.com/minha-loja.myshopify.com',
      'minha-loja.myshopify.com:8080',
      'sub.minha-loja.myshopify.com',
      '.myshopify.com',
      '-loja.myshopify.com',
      'minha_loja.myshopify.com',
      'localhost',
      '127.0.0.1',
      '',
    ]) {
      expect(ehDominioDeLoja(ruim), ruim).toBe(false);
    }
  });
});

describe('normalizarDominio', () => {
  it('aceita o que o lojista costuma digitar', () => {
    for (const entrada of [
      'minha-loja',
      'minha-loja.myshopify.com',
      'https://minha-loja.myshopify.com',
      'https://minha-loja.myshopify.com/admin',
      '  MINHA-LOJA.myshopify.com  ',
    ]) {
      expect(normalizarDominio(entrada), entrada).toBe('minha-loja.myshopify.com');
    }
  });

  it('o que não é loja Shopify vira null', () => {
    for (const ruim of ['evil.com', 'https://evil.com', 'minha loja', '']) {
      expect(normalizarDominio(ruim), ruim).toBeNull();
    }
  });
});

describe('urlDeAutorizacao', () => {
  const pedido = {
    shop: 'minha-loja.myshopify.com',
    clientId: 'cliente-123',
    escopos: 'read_products,read_orders',
    urlDeRetorno: 'https://app.storefy.com.br/api/shopify/callback',
    state: 'nonce-aleatorio',
  };

  it('monta a URL no domínio da loja', () => {
    const url = new URL(urlDeAutorizacao(pedido));
    expect(url.origin).toBe('https://minha-loja.myshopify.com');
    expect(url.pathname).toBe('/admin/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cliente-123');
    expect(url.searchParams.get('scope')).toBe('read_products,read_orders');
    expect(url.searchParams.get('state')).toBe('nonce-aleatorio');
  });

  /*
   * `grant_options[]` vazio pede um token OFFLINE, que continua valendo depois
   * que o lojista fecha a aba. Um token online morre com a sessão dele, e os
   * nossos webhooks e jobs rodam quando ninguém está olhando.
   */
  it('pede token offline', () => {
    const url = new URL(urlDeAutorizacao(pedido));
    expect(url.searchParams.get('grant_options[]')).toBe('');
  });

  it('escapa a URL de retorno', () => {
    const url = urlDeAutorizacao({ ...pedido, urlDeRetorno: 'https://a.b/c?d=1&e=2' });
    expect(url).toContain('redirect_uri=https%3A%2F%2Fa.b%2Fc%3Fd%3D1%26e%3D2');
  });
});

describe('faltamEscopos', () => {
  it('nada falta quando o lojista aceitou tudo', () => {
    expect(faltamEscopos('read_products,read_orders', 'read_orders,read_products')).toEqual([]);
  });

  /*
   * A Shopify devolve o que o lojista ACEITOU, que pode ser menos do que o
   * pedido quando o app foi reinstalado depois de mudarmos a lista. Descobrir
   * na conexão é melhor do que num job que falha de madrugada.
   */
  it('lista o que o lojista não concedeu', () => {
    expect(faltamEscopos('read_products,read_orders,read_customers', 'read_products')).toEqual([
      'read_orders',
      'read_customers',
    ]);
  });

  it('espaço e vazio não viram escopo', () => {
    expect(faltamEscopos(' read_products , ', 'read_products')).toEqual([]);
    expect(faltamEscopos('', 'read_products')).toEqual([]);
  });
});

describe('tópicos', () => {
  /*
   * Faltando qualquer um dos três de privacidade, a Shopify RECUSA o app na
   * revisão. Eles não são opcionais nem negociáveis.
   */
  it('os três webhooks de privacidade estão na lista', () => {
    for (const topico of ['customers/data_request', 'customers/redact', 'shop/redact']) {
      expect(TOPICOS_OBRIGATORIOS as readonly string[]).toContain(topico);
    }
  });

  it('reconhece o que a Shopify manda e recusa o resto', () => {
    for (const topico of TOPICOS) expect(ehTopicoConhecido(topico)).toBe(true);
    for (const outro of ['orders/paid', 'themes/publish', '', 'ORDERS/CREATE']) {
      expect(ehTopicoConhecido(outro), outro).toBe(false);
    }
  });

  it('não há tópico repetido', () => {
    expect(new Set(TOPICOS).size).toBe(TOPICOS.length);
  });
});

describe('urlDoAdmin', () => {
  it('monta o endpoint na versão fixada', () => {
    expect(urlDoAdmin('x.myshopify.com', 'webhooks.json')).toBe(
      'https://x.myshopify.com/admin/api/2025-07/webhooks.json',
    );
    expect(urlDoAdmin('x.myshopify.com', '/graphql.json')).toContain('/2025-07/graphql.json');
  });
});

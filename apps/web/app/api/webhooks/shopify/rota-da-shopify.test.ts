/**
 * O webhook da Shopify, de ponta a ponta.
 *
 * `lib/shopify.test.ts` prova a assinatura e `lib/shopify-webhook.test.ts` o
 * que cada tópico faz; aqui se prova a LIGAÇÃO — que o corpo é lido como texto
 * antes de qualquer `JSON.parse`, que um tópico desconhecido não vira 4xx (a
 * Shopify DESATIVA o webhook da loja depois de uma cadeia deles) e que um erro
 * nosso vira 500, para a Shopify reentregar em vez de perder um pedido.
 */
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import { criptografar } from '@/lib/cripto';

const SEGREDO = 'segredo-do-app-shopify';
const LOJA = 'minha-loja.myshopify.com';
/** Segredo do app personalizado de um lojista, diferente do da Storefy. */
const SEGREDO_DA_LOJA = 'segredo-do-app-do-lojista';
const CHAVE = Buffer.alloc(32, 11).toString('base64');

/** A linha de `stores` que a busca por domínio devolve. */
interface LinhaDaLoja {
  shopify_conexao: 'oauth' | 'manual' | null;
  shopify_client_secret_enc: string | null;
}
let linhaDaLoja: LinhaDaLoja | null = null;

/** O que `aplicarWebhook` recebeu e o que ele vai responder. */
interface Recebido {
  topico: string;
  shop: string;
  corpo: string;
}
let recebido: Recebido | null = null;
let explodir = false;

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave',
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: linhaDaLoja, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/shopify-webhook', () => ({
  aplicarWebhook: (_cliente: unknown, topico: string, shop: string, corpo: string) => {
    recebido = { topico, shop, corpo };
    if (explodir) return Promise.reject(new Error('banco fora do ar'));
    return Promise.resolve({ feito: 'ok' });
  },
}));

const { POST } = await import('@/app/api/webhooks/shopify/route');

let segredoOriginal: string | undefined;
let chaveOriginal: string | undefined;
let avisos: MockInstance<typeof console.warn>;
let erros: MockInstance<typeof console.error>;

beforeEach(() => {
  segredoOriginal = process.env.SHOPIFY_API_SECRET;
  chaveOriginal = process.env.ENCRYPTION_KEY;
  process.env.SHOPIFY_API_SECRET = SEGREDO;
  process.env.ENCRYPTION_KEY = CHAVE;
  // O padrão é a loja conectada pelo app público: ela assina com o segredo
  // da Storefy, que é o caso que a maior parte destes testes exercita.
  linhaDaLoja = { shopify_conexao: 'oauth', shopify_client_secret_enc: null };
  recebido = null;
  explodir = false;
  avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  erros = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  if (segredoOriginal === undefined) delete process.env.SHOPIFY_API_SECRET;
  else process.env.SHOPIFY_API_SECRET = segredoOriginal;
  if (chaveOriginal === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = chaveOriginal;
  avisos.mockRestore();
  erros.mockRestore();
});

function requisicao(
  corpo: string,
  opcoes: { topico?: string; shop?: string; assinatura?: string | null } = {},
): NextRequest {
  const cabecalhos = new Headers({ 'Content-Type': 'application/json' });
  cabecalhos.set('x-shopify-topic', opcoes.topico ?? 'orders/create');
  cabecalhos.set('x-shopify-shop-domain', opcoes.shop ?? LOJA);

  const assinatura =
    opcoes.assinatura === undefined
      ? createHmac('sha256', SEGREDO).update(corpo, 'utf8').digest('base64')
      : opcoes.assinatura;
  if (assinatura !== null) cabecalhos.set('x-shopify-hmac-sha256', assinatura);

  return new NextRequest('https://app.storefy.com.br/api/webhooks/shopify', {
    method: 'POST',
    headers: cabecalhos,
    body: corpo,
  });
}

const PEDIDO = JSON.stringify({ id: 1, total_price: '10.00' });

describe('POST /api/webhooks/shopify', () => {
  it('aceita o webhook assinado e entrega o corpo cru', async () => {
    const resposta = await POST(requisicao(PEDIDO));

    expect(resposta.status).toBe(200);
    expect(recebido).toEqual({ topico: 'orders/create', shop: LOJA, corpo: PEDIDO });
  });

  it('recusa assinatura errada sem processar nada', async () => {
    const resposta = await POST(requisicao(PEDIDO, { assinatura: 'nao-confere' }));

    expect(resposta.status).toBe(401);
    expect(recebido).toBeNull();
  });

  it('recusa sem assinatura nenhuma', async () => {
    expect((await POST(requisicao(PEDIDO, { assinatura: null }))).status).toBe(401);
    expect(recebido).toBeNull();
  });

  /*
   * O corpo é conferido como TEXTO. Se a rota parseasse antes, um payload
   * reserializado passaria — e a assinatura não valeria nada.
   */
  it('corpo diferente do assinado é recusado', async () => {
    const assinatura = createHmac('sha256', SEGREDO).update(PEDIDO, 'utf8').digest('base64');
    const outro = JSON.stringify(JSON.parse(PEDIDO), null, 2);

    expect((await POST(requisicao(outro, { assinatura }))).status).toBe(401);
  });

  /*
   * Sem segredo a rota responde 503, e não 200: a Shopify reentrega quando o
   * ambiente voltar, em vez de dar o evento por entregue.
   */
  it('sem SHOPIFY_API_SECRET responde 503', async () => {
    delete process.env.SHOPIFY_API_SECRET;

    const resposta = await POST(requisicao(PEDIDO, { assinatura: 'qualquer' }));
    expect(resposta.status).toBe(503);
    expect(recebido).toBeNull();
  });

  /*
   * `shop` vira chave de busca no nosso banco e apareceu na URL de quem
   * mandou. Um domínio que não é `.myshopify.com` não passa.
   */
  it('domínio que não é de loja Shopify vira 400', async () => {
    for (const shop of ['evil.com', 'x.myshopify.com.evil.com', '']) {
      const resposta = await POST(requisicao(PEDIDO, { shop }));
      expect(resposta.status, shop).toBe(400);
      expect(recebido).toBeNull();
    }
  });

  /*
   * Tópico desconhecido vira 200, NUNCA 4xx: uma cadeia de respostas de erro
   * faz a Shopify DESATIVAR o webhook da loja, e registrá-lo de novo exigiria
   * reinstalar o app.
   */
  it('tópico que não conhecemos é aceito e ignorado', async () => {
    for (const topico of ['orders/paid', 'themes/publish', 'inventado', '']) {
      const resposta = await POST(requisicao(PEDIDO, { topico }));
      expect(resposta.status, topico).toBe(200);
      expect(recebido).toBeNull();
    }
  });

  /*
   * Falha nossa vira 500 para a Shopify reentregar. Um 200 aqui perderia o
   * pedido para sempre — e um pedido perdido é receita não atribuída, que é
   * justamente o número que sustenta a assinatura.
   */
  it('falha do banco vira 500, para a Shopify tentar de novo', async () => {
    explodir = true;

    const resposta = await POST(requisicao(PEDIDO));
    expect(resposta.status).toBe(500);
  });

  it('a resposta nunca fica em cache', async () => {
    const resposta = await POST(requisicao(PEDIDO));
    expect(resposta.headers.get('cache-control')).toBe('no-store');
  });

  /** Os webhooks de privacidade passam igual aos outros. */
  it('os tópicos obrigatórios da Shopify chegam ao tratamento', async () => {
    for (const topico of [
      'customers/data_request',
      'customers/redact',
      'shop/redact',
      'app/uninstalled',
    ]) {
      recebido = null;
      const resposta = await POST(requisicao('{}', { topico }));

      expect(resposta.status, topico).toBe(200);
      expect(recebido, topico).toMatchObject({ topico });
    }
  });

  /*
   * Desde o app personalizado, cada loja assina com o segredo DELA. O que
   * estes casos protegem é a escolha do segredo: a rota lê o domínio do
   * cabeçalho — que vem de fora — antes de conferir a assinatura, e isso só é
   * seguro porque o domínio escolhe a fechadura e a assinatura continua sendo
   * a chave.
   */
  describe('cada loja tem o seu segredo', () => {
    function comoLojaManual(): void {
      linhaDaLoja = {
        shopify_conexao: 'manual',
        shopify_client_secret_enc: criptografar(SEGREDO_DA_LOJA),
      };
    }

    function assinarCom(segredo: string, corpo: string): string {
      return createHmac('sha256', segredo).update(corpo, 'utf8').digest('base64');
    }

    it('aceita o webhook assinado com o segredo do app do lojista', async () => {
      comoLojaManual();

      const resposta = await POST(
        requisicao(PEDIDO, { assinatura: assinarCom(SEGREDO_DA_LOJA, PEDIDO) }),
      );

      expect(resposta.status).toBe(200);
      expect(recebido).toMatchObject({ shop: LOJA });
    });

    /*
     * ESTE É O CASO QUE IMPORTA. Quem tem o `SHOPIFY_API_SECRET` da Storefy —
     * um vazamento nosso, ou qualquer outro app público — não pode falar em
     * nome de uma loja que assina com o próprio segredo. Se este teste
     * passasse a devolver 200, um segredo só voltaria a abrir todas as lojas.
     */
    it('recusa o segredo da Storefy numa loja que tem o seu', async () => {
      comoLojaManual();

      const resposta = await POST(requisicao(PEDIDO, { assinatura: assinarCom(SEGREDO, PEDIDO) }));

      expect(resposta.status).toBe(401);
      expect(recebido).toBeNull();
    });

    /* E o contrário: o segredo de um lojista não abre a loja de outro. */
    it('recusa o segredo de uma loja numa loja conectada pelo app público', async () => {
      const resposta = await POST(
        requisicao(PEDIDO, { assinatura: assinarCom(SEGREDO_DA_LOJA, PEDIDO) }),
      );

      expect(resposta.status).toBe(401);
      expect(recebido).toBeNull();
    });

    /*
     * Loja que a Storefy não conhece cai no segredo dela, e não em 503: é a
     * loja que ACABOU de instalar o app público e ainda não tem linha, e é a
     * que desinstalou — cujo `app/uninstalled` é justamente este webhook.
     * Negar os dois quebraria a instalação e a desinstalação.
     */
    it('loja desconhecida ainda é atendida com o segredo da Storefy', async () => {
      linhaDaLoja = null;

      const resposta = await POST(requisicao('{}', { topico: 'app/uninstalled' }));

      expect(resposta.status).toBe(200);
      expect(recebido).toMatchObject({ topico: 'app/uninstalled' });
    });

    /*
     * A conexão manual sem segredo guardado não pode cair no da Storefy: seria
     * aceitar como boa uma assinatura que aquela loja não produz. O banco
     * recusa essa linha por constraint; aqui se prova o que a rota faz se ela
     * existir mesmo assim.
     */
    it('conexão manual sem segredo não aceita o segredo da Storefy', async () => {
      for (const enc of ['lixo-que-nao-abre', null, '']) {
        linhaDaLoja = { shopify_conexao: 'manual', shopify_client_secret_enc: enc };
        recebido = null;

        const resposta = await POST(
          requisicao(PEDIDO, { assinatura: assinarCom(SEGREDO, PEDIDO) }),
        );

        expect(resposta.status, String(enc)).toBe(503);
        expect(recebido, String(enc)).toBeNull();
      }
    });
  });
});

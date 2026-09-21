/**
 * O que fala com a Shopify pela rede.
 *
 * A rede é falsa aqui, e é a única coisa que é: as decisões testadas — o que
 * conta como sucesso, o que nunca aparece na tela, o que não derruba o resto —
 * são as mesmas que rodam em produção.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  apagarWebhooks,
  escoposPedidos,
  lerRespostaDoToken,
  registrarWebhooks,
  shopifyConfigurado,
  trocarCodePorToken,
} from '@/lib/shopify-servidor';
import { TOPICOS, VERSAO_DA_API } from '@/lib/shopify';

const LOJA = 'minha-loja.myshopify.com';
const URL_DO_WEBHOOK = 'https://app.storefy.com.br/api/webhooks/shopify';

const ORIGINAIS = {
  chave: process.env.SHOPIFY_API_KEY,
  segredo: process.env.SHOPIFY_API_SECRET,
  escopos: process.env.SHOPIFY_SCOPES,
};

let avisos: MockInstance<typeof console.warn>;

beforeEach(() => {
  process.env.SHOPIFY_API_KEY = 'chave-do-app';
  process.env.SHOPIFY_API_SECRET = 'segredo-do-app';
  delete process.env.SHOPIFY_SCOPES;
  avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  if (ORIGINAIS.chave === undefined) delete process.env.SHOPIFY_API_KEY;
  else process.env.SHOPIFY_API_KEY = ORIGINAIS.chave;

  if (ORIGINAIS.segredo === undefined) delete process.env.SHOPIFY_API_SECRET;
  else process.env.SHOPIFY_API_SECRET = ORIGINAIS.segredo;

  if (ORIGINAIS.escopos === undefined) delete process.env.SHOPIFY_SCOPES;
  else process.env.SHOPIFY_SCOPES = ORIGINAIS.escopos;

  avisos.mockRestore();
});

/** O alvo da chamada, como texto, seja qual for a forma que o fetch aceita. */
function urlDe(url: string | URL | Request): string {
  if (typeof url === 'string') return url;
  return url instanceof URL ? url.toString() : url.url;
}

/** O corpo enviado, que nos nossos casos é sempre JSON em texto. */
function corpoDe(opcoes: RequestInit | undefined): unknown {
  return typeof opcoes?.body === 'string' ? JSON.parse(opcoes.body) : null;
}

function resposta(corpo: unknown, status = 200): Response {
  return new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('shopifyConfigurado', () => {
  it('exige as duas metades do app', () => {
    expect(shopifyConfigurado()).toBe(true);

    delete process.env.SHOPIFY_API_SECRET;
    expect(shopifyConfigurado()).toBe(false);

    process.env.SHOPIFY_API_SECRET = '';
    process.env.SHOPIFY_API_KEY = 'chave';
    expect(shopifyConfigurado()).toBe(false);
  });
});

describe('escoposPedidos', () => {
  it('usa a lista padrão quando a variável não existe', () => {
    expect(escoposPedidos()).toContain('read_orders');
  });

  it('e respeita a lista do ambiente, sem espaço em volta', () => {
    process.env.SHOPIFY_SCOPES = '  read_orders,read_products  ';
    expect(escoposPedidos()).toBe('read_orders,read_products');
  });

  it('variável em branco volta para o padrão em vez de pedir escopo nenhum', () => {
    process.env.SHOPIFY_SCOPES = '   ';
    expect(escoposPedidos()).toContain('read_orders');
  });
});

describe('lerRespostaDoToken', () => {
  it('aceita a resposta boa', () => {
    const lido = lerRespostaDoToken({ access_token: 'shpat_123', scope: 'read_orders' });

    expect(lido).toEqual({ ok: true, token: 'shpat_123', escopos: 'read_orders' });
  });

  it('sem escopo na resposta, a conexão continua: a tela é que avisa', () => {
    const lido = lerRespostaDoToken({ access_token: 'shpat_123' });

    expect(lido.ok).toBe(true);
    if (lido.ok) expect(lido.escopos).toBe('');
  });

  it('recusa qualquer formato que não traga o token', () => {
    for (const corpo of [null, 'texto', 42, {}, { access_token: '' }, { access_token: 7 }]) {
      expect(lerRespostaDoToken(corpo).ok, JSON.stringify(corpo)).toBe(false);
    }
  });
});

describe('trocarCodePorToken', () => {
  it('manda o segredo no corpo e devolve o token', async () => {
    let pedido: { url: string; corpo: unknown } | null = null;
    const falso = vi.fn(async (url: string | URL | Request, opcoes?: RequestInit) => {
      pedido = { url: urlDe(url), corpo: corpoDe(opcoes) };
      return await Promise.resolve(resposta({ access_token: 'shpat_1', scope: 'read_orders' }));
    });

    const troca = await trocarCodePorToken(LOJA, 'codigo', falso);

    expect(troca).toEqual({ ok: true, token: 'shpat_1', escopos: 'read_orders' });
    expect(pedido).toEqual({
      url: `https://${LOJA}/admin/oauth/access_token`,
      corpo: { client_id: 'chave-do-app', client_secret: 'segredo-do-app', code: 'codigo' },
    });
  });

  /*
   * O corpo do erro da Shopify às vezes ecoa o `client_secret` que mandamos.
   * Ele NÃO pode virar a mensagem da tela — este teste é o que impede alguém
   * de "melhorar" a mensagem repassando o que veio.
   */
  it('o corpo do erro da Shopify nunca vira mensagem', async () => {
    const falso = vi.fn(
      async () =>
        await Promise.resolve(
          resposta({ error: 'invalid_request', client_secret: 'segredo-do-app' }, 400),
        ),
    );

    const troca = await trocarCodePorToken(LOJA, 'codigo', falso);

    expect(troca.ok).toBe(false);
    if (!troca.ok) {
      expect(troca.motivo).not.toContain('segredo-do-app');
      expect(troca.motivo).not.toContain('invalid_request');
      // 400 é "o code expirou", e a mensagem diz o que fazer.
      expect(troca.motivo).toContain('conectar');
    }
  });

  it('erro de rede vira recusa, e não exceção', async () => {
    const falso = vi.fn(async () => await Promise.reject(new Error('sem rede')));

    const troca = await trocarCodePorToken(LOJA, 'codigo', falso);

    expect(troca.ok).toBe(false);
  });

  it('sem o app configurado nem chega a sair da máquina', async () => {
    delete process.env.SHOPIFY_API_SECRET;
    const falso = vi.fn(async () => await Promise.resolve(resposta({})));

    const troca = await trocarCodePorToken(LOJA, 'codigo', falso);

    expect(troca.ok).toBe(false);
    expect(falso).not.toHaveBeenCalled();
  });
});

describe('registrarWebhooks', () => {
  it('registra todos os tópicos na mesma URL', async () => {
    const pedidos: string[] = [];
    const falso = vi.fn(async (_url: string | URL | Request, opcoes?: RequestInit) => {
      const corpo = corpoDe(opcoes) as { webhook: { topic: string } };
      pedidos.push(corpo.webhook.topic);
      return await Promise.resolve(resposta({ webhook: { id: 1 } }, 201));
    });

    const feito = await registrarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, falso);

    expect(feito.registrados).toEqual([...TOPICOS]);
    expect(feito.falharam).toEqual([]);
    expect(pedidos).toEqual([...TOPICOS]);
  });

  /*
   * 422 "already been taken" é REINSTALAÇÃO, não falha. Tratar como erro faria
   * quem reinstalou o app ver "conexão quebrada" numa conexão que está de pé.
   */
  it('webhook que já existe conta como registrado', async () => {
    const falso = vi.fn(
      async () =>
        await Promise.resolve(
          resposta({ errors: { address: ['for this topic has already been taken'] } }, 422),
        ),
    );

    const feito = await registrarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, falso);

    expect(feito.falharam).toEqual([]);
  });

  it('mas um 422 de outro motivo é falha de verdade', async () => {
    const falso = vi.fn(
      async () => await Promise.resolve(resposta({ errors: { topic: ['is invalid'] } }, 422)),
    );

    const feito = await registrarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, falso);

    expect(feito.registrados).toEqual([]);
    expect(feito.falharam).toEqual([...TOPICOS]);
  });

  /*
   * Um tópico que falha não derruba os outros: a loja com `orders/create`
   * registrado e `products/update` não é uma loja quebrada.
   */
  it('a falha de um tópico não impede os outros', async () => {
    let chamada = 0;
    const falso = vi.fn(async () => {
      chamada += 1;
      return chamada === 2
        ? await Promise.resolve(resposta({ erro: 'nao' }, 500))
        : await Promise.resolve(resposta({ webhook: { id: 1 } }, 201));
    });

    const feito = await registrarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, falso);

    expect(feito.falharam).toHaveLength(1);
    expect(feito.registrados).toHaveLength(TOPICOS.length - 1);
  });
});

describe('apagarWebhooks', () => {
  /*
   * Só os que apontam para a NOSSA url. Uma loja pode ter webhooks de outros
   * apps no mesmo tópico, e apagá-los seria quebrar a ferramenta de terceiro.
   */
  it('apaga só os webhooks que apontam para a Storefy', async () => {
    const apagados: string[] = [];
    const falso = vi.fn(async (url: string | URL | Request, opcoes?: RequestInit) => {
      if (opcoes?.method === 'DELETE') {
        apagados.push(urlDe(url));
        return await Promise.resolve(resposta({}, 200));
      }
      return await Promise.resolve(
        resposta({
          webhooks: [
            { id: 10, address: URL_DO_WEBHOOK },
            { id: 11, address: 'https://outro-app.com/hook' },
            { id: 12, address: URL_DO_WEBHOOK },
          ],
        }),
      );
    });

    const quantos = await apagarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, falso);

    expect(quantos).toBe(2);
    expect(apagados).toEqual([
      `https://${LOJA}/admin/api/${VERSAO_DA_API}/webhooks/10.json`,
      `https://${LOJA}/admin/api/${VERSAO_DA_API}/webhooks/12.json`,
    ]);
  });

  /** 404 é o estado desejado: ele já não existe. */
  it('webhook que já sumiu conta como apagado', async () => {
    const falso = vi.fn(async (_url: string | URL | Request, opcoes?: RequestInit) =>
      opcoes?.method === 'DELETE'
        ? await Promise.resolve(resposta({}, 404))
        : await Promise.resolve(resposta({ webhooks: [{ id: 10, address: URL_DO_WEBHOOK }] })),
    );

    expect(await apagarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, falso)).toBe(1);
  });

  /*
   * O token pode já ter sido revogado por uma desinstalação na própria
   * Shopify. A desconexão no painel não pode travar por causa disso.
   */
  it('token revogado não vira exceção', async () => {
    const falso = vi.fn(async () => await Promise.resolve(resposta({ errors: '...' }, 401)));

    expect(await apagarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, falso)).toBe(0);
  });

  it('nem a rede fora do ar', async () => {
    const falso = vi.fn(async () => await Promise.reject(new Error('sem rede')));

    expect(await apagarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, falso)).toBe(0);
  });

  it('corpo em formato inesperado não apaga nada', async () => {
    const falso = vi.fn(async () => await Promise.resolve(resposta({ webhooks: 'nada disso' })));

    expect(await apagarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, falso)).toBe(0);
  });
});

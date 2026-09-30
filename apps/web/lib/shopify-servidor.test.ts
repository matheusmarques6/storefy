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
  vincularAppNoDominio,
} from '@/lib/shopify-servidor';
import { TOPICOS_DA_LOJA, VERSAO_DA_API } from '@/lib/shopify';

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

/** Um aviso da Shopify, como a GraphQL o guarda. */
interface AvisoFalso {
  id: string;
  topic: string;
  uri: string;
}

/**
 * A GraphQL da Shopify, só com os avisos: o que a loja tem e o que se pede.
 * Guarda estado, para o teste provar o que ficou de pé — e não só o que foi
 * pedido.
 */
function shopifyDosAvisos(
  inicial: AvisoFalso[] = [],
  recusar: (topico: string) => boolean = () => false,
) {
  const avisos = [...inicial];
  const pedidos: { url: string; consulta: string; variaveis: Record<string, unknown> }[] = [];
  const buscador = vi.fn(async (url: string | URL | Request, opcoes?: RequestInit) => {
    const corpo = corpoDe(opcoes) as { query: string; variables: Record<string, unknown> };
    pedidos.push({ url: urlDe(url), consulta: corpo.query, variaveis: corpo.variables });
    const { query: consulta, variables: variaveis } = corpo;

    if (consulta.includes('webhookSubscriptions(')) {
      const nodes = avisos
        .filter((aviso) => aviso.uri === variaveis.uri)
        .map(({ id, topic }) => ({ id, topic }));
      return await Promise.resolve(resposta({ data: { webhookSubscriptions: { nodes } } }));
    }
    if (consulta.includes('webhookSubscriptionCreate')) {
      const topic = String(variaveis.topic);
      if (recusar(topic)) {
        return await Promise.resolve(
          resposta({
            data: {
              webhookSubscriptionCreate: {
                webhookSubscription: null,
                userErrors: [{ field: ['topic'], message: 'Recusado' }],
              },
            },
          }),
        );
      }
      const id = `gid://shopify/WebhookSubscription/${String(avisos.length + 100)}`;
      avisos.push({ id, topic, uri: String(variaveis.uri) });
      return await Promise.resolve(
        resposta({
          data: { webhookSubscriptionCreate: { webhookSubscription: { id }, userErrors: [] } },
        }),
      );
    }
    if (consulta.includes('webhookSubscriptionDelete')) {
      const indice = avisos.findIndex((aviso) => aviso.id === variaveis.id);
      if (indice >= 0) avisos.splice(indice, 1);
      return await Promise.resolve(
        resposta({
          data: {
            webhookSubscriptionDelete:
              indice >= 0
                ? { deletedWebhookSubscriptionId: variaveis.id, userErrors: [] }
                : { deletedWebhookSubscriptionId: null, userErrors: [{ message: 'Não existe' }] },
          },
        }),
      );
    }
    return await Promise.resolve(resposta({ errors: [{ message: 'consulta inesperada' }] }));
  });
  return { avisos, pedidos, buscador };
}

describe('registrarWebhooks', () => {
  /*
   * O defeito: os três de privacidade iam para a API, loja a loja, e a
   * Shopify os recusa sempre (só existem na configuração do app). Toda
   * conexão saía "parcial", mandando o lojista reconectar à toa.
   */
  it('registra os avisos da loja pela GraphQL, na mesma URL — e nunca os de privacidade', async () => {
    const shopify = shopifyDosAvisos();

    const feito = await registrarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, shopify.buscador);

    expect(feito).toEqual({
      registrados: [...TOPICOS_DA_LOJA],
      falharam: [],
      acessoRecusado: false,
      semResposta: false,
    });
    expect(shopify.avisos.map((aviso) => aviso.topic)).toEqual([
      'APP_UNINSTALLED',
      'ORDERS_CREATE',
      'FULFILLMENTS_CREATE',
      'PRODUCTS_UPDATE',
    ]);
    expect(shopify.avisos.every((aviso) => aviso.uri === URL_DO_WEBHOOK)).toBe(true);
    // A GraphQL da versão da API, e nada pela REST (legado).
    for (const pedido of shopify.pedidos) {
      expect(pedido.url).toBe(`https://${LOJA}/admin/api/${VERSAO_DA_API}/graphql.json`);
    }
    expect(JSON.stringify(shopify.pedidos)).not.toMatch(/CUSTOMERS_|SHOP_REDACT/);
  });

  /* Reconectar, e a conferência de hora em hora, não duplicam nada. */
  it('só cria o que falta, e o aviso de outro app no mesmo tópico não conta', async () => {
    const shopify = shopifyDosAvisos([
      { id: 'gid://1', topic: 'APP_UNINSTALLED', uri: URL_DO_WEBHOOK },
      { id: 'gid://2', topic: 'ORDERS_CREATE', uri: URL_DO_WEBHOOK },
      { id: 'gid://3', topic: 'PRODUCTS_UPDATE', uri: 'https://outro-app.com/hook' },
    ]);

    const feito = await registrarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, shopify.buscador);

    expect(feito.falharam).toEqual([]);
    const criados = shopify.pedidos.filter((pedido) =>
      pedido.consulta.includes('webhookSubscriptionCreate'),
    );
    expect(criados.map((pedido) => pedido.variaveis.topic)).toEqual([
      'FULFILLMENTS_CREATE',
      'PRODUCTS_UPDATE',
    ]);
  });

  /*
   * Um tópico que falha não derruba os outros: a loja com `orders/create`
   * registrado e `products/update` não é uma loja quebrada.
   */
  it('a recusa de um tópico não impede os outros', async () => {
    const shopify = shopifyDosAvisos([], (topico) => topico === 'PRODUCTS_UPDATE');

    const feito = await registrarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, shopify.buscador);

    expect(feito.falharam).toEqual(['products/update']);
    expect(feito.registrados).toEqual(['app/uninstalled', 'orders/create', 'fulfillments/create']);
  });

  it('o token recusado diz isso, sem tentar criar nada', async () => {
    const falso = vi.fn(async () => await Promise.resolve(resposta({ errors: 'x' }, 401)));

    const feito = await registrarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, falso);

    expect(feito).toMatchObject({ acessoRecusado: true, semResposta: false });
    expect(feito.falharam).toEqual([...TOPICOS_DA_LOJA]);
    expect(falso).toHaveBeenCalledTimes(1);
  });

  /* Sem resposta não se sabe o que falta: "faltam todos" seria alarme falso. */
  it('a Shopify fora do ar vira "sem resposta", e não "acesso recusado"', async () => {
    const falso = vi.fn(async () => await Promise.reject(new Error('sem rede')));

    const feito = await registrarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, falso);

    expect(feito).toMatchObject({ acessoRecusado: false, semResposta: true });
  });
});

describe('apagarWebhooks', () => {
  /*
   * Só os que apontam para a NOSSA url. Uma loja pode ter avisos de outros
   * apps no mesmo tópico, e apagá-los seria quebrar a ferramenta de terceiro.
   */
  it('apaga só os avisos que apontam para a Storefy', async () => {
    const shopify = shopifyDosAvisos([
      { id: 'gid://10', topic: 'ORDERS_CREATE', uri: URL_DO_WEBHOOK },
      { id: 'gid://11', topic: 'ORDERS_CREATE', uri: 'https://outro-app.com/hook' },
      { id: 'gid://12', topic: 'APP_UNINSTALLED', uri: URL_DO_WEBHOOK },
    ]);

    const quantos = await apagarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, shopify.buscador);

    expect(quantos).toBe(2);
    expect(shopify.avisos).toEqual([
      { id: 'gid://11', topic: 'ORDERS_CREATE', uri: 'https://outro-app.com/hook' },
    ]);
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

  it('resposta em formato inesperado não apaga nada', async () => {
    const falso = vi.fn(
      async () => await Promise.resolve(resposta({ data: { webhookSubscriptions: 'nada disso' } })),
    );

    expect(await apagarWebhooks(LOJA, 'shpat_1', URL_DO_WEBHOOK, falso)).toBe(0);
    expect(falso).toHaveBeenCalledTimes(1);
  });
});

describe('vincularAppNoDominio', () => {
  const IMPRESSAO =
    '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';
  const ALVO = {
    apple: { appId: 'A1B2C3D4E5.me.convertfy.oakvintage' },
    android: { applicationId: 'me.convertfy.oakvintage', impressoes: [IMPRESSAO] },
  };

  interface Chamada {
    url: string;
    query: string;
    variables: Record<string, unknown>;
  }

  /** Uma Admin API falsa: responde a lista e as mutações, e guarda tudo. */
  function adminFalsa(opcoes: {
    existentes?: unknown[];
    respostaDaLista?: () => Response;
    respostaDaMutacao?: (chamada: Chamada) => Response;
  }) {
    const chamadas: Chamada[] = [];
    const falso = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const corpo = corpoDe(init) as { query: string; variables: Record<string, unknown> };
      const chamada = { url: urlDe(url), query: corpo.query, variables: corpo.variables };
      chamadas.push(chamada);
      if (corpo.query.includes('mobilePlatformApplications(')) {
        return await Promise.resolve(
          opcoes.respostaDaLista?.() ??
            resposta({ data: { mobilePlatformApplications: { nodes: opcoes.existentes ?? [] } } }),
        );
      }
      const campo = corpo.query.includes('mobilePlatformApplicationCreate')
        ? 'mobilePlatformApplicationCreate'
        : 'mobilePlatformApplicationUpdate';
      return await Promise.resolve(
        opcoes.respostaDaMutacao?.(chamada) ??
          resposta({
            data: {
              [campo]: { mobilePlatformApplication: { __typename: 'X' }, userErrors: [] },
            },
          }),
      );
    });
    return { falso, chamadas };
  }

  it('cadastra as duas plataformas na loja que ainda não tem nada', async () => {
    const { falso, chamadas } = adminFalsa({});

    const resultado = await vincularAppNoDominio(LOJA, 'shpat_1', ALVO, falso);

    expect(resultado).toEqual({ ios: 'vinculado', android: 'vinculado', erro: null });
    expect(chamadas[0]?.url).toBe(`https://${LOJA}/admin/api/${VERSAO_DA_API}/graphql.json`);
    const criacoes = chamadas.filter((c) => c.query.includes('mobilePlatformApplicationCreate'));
    expect(criacoes.map((c) => c.variables)).toEqual([
      {
        input: {
          apple: {
            appId: 'A1B2C3D4E5.me.convertfy.oakvintage',
            universalLinksEnabled: true,
            sharedWebCredentialsEnabled: false,
          },
        },
      },
      {
        input: {
          android: {
            applicationId: 'me.convertfy.oakvintage',
            sha256CertFingerprints: [IMPRESSAO],
            appLinksEnabled: true,
          },
        },
      },
    ]);
  });

  it('o que já existe é atualizado, e não duplicado; o de outro app fica como está', async () => {
    const { falso, chamadas } = adminFalsa({
      existentes: [
        {
          __typename: 'AppleApplication',
          id: 'gid://1',
          appId: 'A1B2C3D4E5.me.convertfy.oakvintage',
        },
        { __typename: 'AndroidApplication', id: 'gid://2', applicationId: 'com.outra.ferramenta' },
      ],
    });

    const resultado = await vincularAppNoDominio(LOJA, 'shpat_1', ALVO, falso);

    expect(resultado.ios).toBe('vinculado');
    const atualizacoes = chamadas.filter((c) =>
      c.query.includes('mobilePlatformApplicationUpdate'),
    );
    expect(atualizacoes).toHaveLength(1);
    expect(atualizacoes[0]?.variables.id).toBe('gid://1');
    // O Android da outra ferramenta não é tocado: o nosso é criado ao lado.
    const criacoes = chamadas.filter((c) => c.query.includes('mobilePlatformApplicationCreate'));
    expect(criacoes).toHaveLength(1);
    expect(JSON.stringify(chamadas)).not.toContain('gid://2');
  });

  it('só a plataforma pedida: sem Android, nada de Android', async () => {
    const { falso, chamadas } = adminFalsa({});

    const resultado = await vincularAppNoDominio(
      LOJA,
      'shpat_1',
      { apple: ALVO.apple, android: null },
      falso,
    );

    expect(resultado).toEqual({ ios: 'vinculado', android: null, erro: null });
    const mutacoes = chamadas.filter((c) => c.query.startsWith('mutation'));
    expect(mutacoes).toHaveLength(1);
    expect(mutacoes[0]?.variables).toEqual({ input: { apple: expect.any(Object) as object } });
  });

  /*
   * A GraphQL da Shopify nega acesso com status 200 e `errors` no corpo. Olhar
   * só o status faria uma permissão faltando parecer sucesso.
   */
  it('permissão negada com status 200 é falha, com a frase que o lojista entende', async () => {
    const { falso } = adminFalsa({
      respostaDaLista: () =>
        resposta({
          errors: [
            {
              message:
                'Access denied for mobilePlatformApplications field. Required access: `read_mobile_platform_applications` access scope.',
            },
          ],
        }),
    });

    const resultado = await vincularAppNoDominio(LOJA, 'shpat_1', ALVO, falso);

    expect(resultado.ios).toBe('falhou');
    expect(resultado.android).toBe('falhou');
    expect(resultado.erro).toMatch(/permissão/);
    expect(resultado.erro).not.toMatch(/Access denied|scope/);
  });

  it('userErrors da Shopify contam como falha daquela plataforma só', async () => {
    const { falso } = adminFalsa({
      respostaDaMutacao: (chamada) =>
        JSON.stringify(chamada.variables).includes('android')
          ? resposta({
              data: {
                mobilePlatformApplicationCreate: {
                  mobilePlatformApplication: null,
                  userErrors: [{ field: ['sha256CertFingerprints'], message: 'is invalid' }],
                },
              },
            })
          : resposta({
              data: {
                mobilePlatformApplicationCreate: {
                  mobilePlatformApplication: { __typename: 'AppleApplication' },
                  userErrors: [],
                },
              },
            }),
    });

    const resultado = await vincularAppNoDominio(LOJA, 'shpat_1', ALVO, falso);

    expect(resultado.ios).toBe('vinculado');
    expect(resultado.android).toBe('falhou');
    expect(resultado.erro).toMatch(/não aceitou/);
    expect(resultado.erro).not.toContain('is invalid');
  });

  it('token revogado e rede fora do ar viram frase, e não exceção', async () => {
    const revogado = vi.fn(async () => await Promise.resolve(resposta({ errors: '...' }, 401)));
    expect((await vincularAppNoDominio(LOJA, 'x', ALVO, revogado)).erro).toMatch(/Reconecte/);

    const semRede = vi.fn(async () => await Promise.reject(new Error('sem rede')));
    expect((await vincularAppNoDominio(LOJA, 'x', ALVO, semRede)).erro).toMatch(/Tente de novo/);
  });
});

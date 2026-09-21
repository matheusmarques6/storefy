/**
 * O OAuth da Shopify, de ponta a ponta.
 *
 * É a parte mais perigosa desta fase: um erro aqui conecta a loja de um
 * cliente à conta de outro, ou aceita um retorno forjado e guarda um token que
 * não veio da Shopify. Por isso a assinatura NÃO é mockada — o que roda nos
 * testes é a conferência de verdade.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import type * as ModuloDoContextoNS from '@/lib/contexto';
import type * as ModuloDaShopifyNS from '@/lib/shopify-servidor';

type ModuloDoContexto = typeof ModuloDoContextoNS;
type ModuloDaShopify = typeof ModuloDaShopifyNS;

const SEGREDO = 'segredo-do-app-shopify';
const CHAVE_CRIPTO = randomBytes(32).toString('base64');
const LOJA = 'minha-loja.myshopify.com';
const ID_DA_LOJA = '11111111-1111-4111-8111-111111111111';
const ID_DA_ORG = '22222222-2222-4222-8222-222222222222';

/** O que o contexto do painel devolve neste teste. */
let contexto: { lojaAtiva: { id: string } | null; papel: string } = {
  lojaAtiva: { id: ID_DA_LOJA },
  papel: 'owner',
};

/** O que cada client do Supabase recebeu. */
let gravouSessao: Record<string, unknown> | null = null;
let gravouServico: Record<string, unknown> | null = null;
let erroDaGravacao: { message: string } | null = null;

/** O que os módulos de rede da Shopify vão responder. */
let troca: { ok: boolean; token?: string; escopos?: string; motivo?: string } = {
  ok: true,
  token: 'shpat_do_teste',
  escopos: 'read_products,read_orders,read_customers,read_fulfillments',
};
let webhooks: { registrados: string[]; falharam: string[] } = { registrados: [], falharam: [] };

vi.mock('@/lib/contexto', async (original) => ({
  ...(await original<ModuloDoContexto>()),
  exigirContextoCliente: () => Promise.resolve(contexto),
}));

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  urlDoSite: () => 'https://app.storefy.com.br',
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave',
}));

function clientFalso(registro: (dados: Record<string, unknown>) => void) {
  return {
    from: () => ({
      update: (dados: Record<string, unknown>) => {
        registro(dados);
        return {
          eq: () => ({
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: erroDaGravacao === null ? { id: ID_DA_LOJA, org_id: ID_DA_ORG } : null,
                  error: erroDaGravacao,
                }),
            }),
            then: (resolver: (r: unknown) => unknown) =>
              resolver({ data: null, error: erroDaGravacao }),
          }),
        };
      },
    }),
  };
}

vi.mock('@/lib/supabase/server', () => ({
  criarClientServidor: () =>
    Promise.resolve(
      clientFalso((dados) => {
        gravouSessao = dados;
      }),
    ),
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () =>
    clientFalso((dados) => {
      gravouServico = dados;
    }),
}));

vi.mock('@/lib/shopify-servidor', async (original) => ({
  ...(await original<ModuloDaShopify>()),
  trocarCodePorToken: () => Promise.resolve(troca),
  registrarWebhooks: () => Promise.resolve(webhooks),
}));

const { POST: instalar, COOKIE_DO_STATE } = await import('@/app/api/shopify/install/route');
const { GET: retornar } = await import('@/app/api/shopify/callback/route');

let avisos: MockInstance<typeof console.warn>;
let erros: MockInstance<typeof console.error>;
const ANTERIORES = {
  chave: process.env.SHOPIFY_API_KEY,
  segredo: process.env.SHOPIFY_API_SECRET,
  cripto: process.env.ENCRYPTION_KEY,
};

beforeEach(() => {
  process.env.SHOPIFY_API_KEY = 'chave-do-app';
  process.env.SHOPIFY_API_SECRET = SEGREDO;
  process.env.ENCRYPTION_KEY = CHAVE_CRIPTO;

  contexto = { lojaAtiva: { id: ID_DA_LOJA }, papel: 'owner' };
  gravouSessao = null;
  gravouServico = null;
  erroDaGravacao = null;
  troca = {
    ok: true,
    token: 'shpat_do_teste',
    escopos: 'read_products,read_orders,read_customers,read_fulfillments',
  };
  webhooks = { registrados: [], falharam: [] };

  avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  erros = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  if (ANTERIORES.chave === undefined) delete process.env.SHOPIFY_API_KEY;
  else process.env.SHOPIFY_API_KEY = ANTERIORES.chave;

  if (ANTERIORES.segredo === undefined) delete process.env.SHOPIFY_API_SECRET;
  else process.env.SHOPIFY_API_SECRET = ANTERIORES.segredo;

  if (ANTERIORES.cripto === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ANTERIORES.cripto;

  avisos.mockRestore();
  erros.mockRestore();
});

function pedidoDeInstalacao(shop: string): NextRequest {
  const corpo = new FormData();
  corpo.set('shop', shop);
  return new NextRequest('https://app.storefy.com.br/api/shopify/install', {
    method: 'POST',
    body: corpo,
  });
}

/** O código de `?shopify=` de uma resposta de redirecionamento. */
function codigo(resposta: Response): string | null {
  const destino = resposta.headers.get('location');
  return destino === null ? null : new URL(destino).searchParams.get('shopify');
}

describe('POST /api/shopify/install', () => {
  it('manda o lojista para a autorização da Shopify e guarda o state', async () => {
    const resposta = await instalar(pedidoDeInstalacao(LOJA));

    expect(resposta.status).toBe(303);

    const destino = new URL(resposta.headers.get('location') ?? '');
    expect(destino.host).toBe(LOJA);
    expect(destino.pathname).toBe('/admin/oauth/authorize');
    expect(destino.searchParams.get('client_id')).toBe('chave-do-app');
    expect(destino.searchParams.get('redirect_uri')).toBe(
      'https://app.storefy.com.br/api/shopify/callback',
    );
    // `grant_options[]` vazio é o que pede um token OFFLINE, que continua
    // valendo depois que o lojista fecha a aba.
    expect(destino.searchParams.get('grant_options[]')).toBe('');

    const guardado = resposta.cookies.get(COOKIE_DO_STATE);
    expect(guardado?.httpOnly).toBe(true);
    expect(guardado?.sameSite).toBe('lax');
    // O cookie carrega `state.storeId`: conferir só o state provaria que a ida
    // partiu daqui, mas não DE QUAL LOJA.
    expect(guardado?.value).toBe(`${destino.searchParams.get('state') ?? ''}.${ID_DA_LOJA}`);
    expect(gravouSessao).toEqual({ shop_domain: LOJA });
  });

  it('cada conexão tem um state diferente', async () => {
    const um = await instalar(pedidoDeInstalacao(LOJA));
    const outro = await instalar(pedidoDeInstalacao(LOJA));

    expect(um.cookies.get(COOKIE_DO_STATE)?.value).not.toBe(
      outro.cookies.get(COOKIE_DO_STATE)?.value,
    );
  });

  it('normaliza o que o lojista digitou', async () => {
    const resposta = await instalar(
      pedidoDeInstalacao('  HTTPS://Minha-Loja.myshopify.com/admin '),
    );

    expect(new URL(resposta.headers.get('location') ?? '').host).toBe(LOJA);
  });

  it('quem não é dono nem admin não conecta nada', async () => {
    contexto = { lojaAtiva: { id: ID_DA_LOJA }, papel: 'member' };

    const resposta = await instalar(pedidoDeInstalacao(LOJA));

    expect(codigo(resposta)).toBe('sem_permissao');
    expect(gravouSessao).toBeNull();
  });

  it('sem loja ativa não há o que conectar', async () => {
    contexto = { lojaAtiva: null, papel: 'owner' };

    expect(codigo(await instalar(pedidoDeInstalacao(LOJA)))).toBe('sem_loja');
  });

  it('sem o app da Storefy configurado, nem começa', async () => {
    delete process.env.SHOPIFY_API_SECRET;

    expect(codigo(await instalar(pedidoDeInstalacao(LOJA)))).toBe('nao_configurado');
    expect(gravouSessao).toBeNull();
  });

  /*
   * O `shop` vira o HOST de uma chamada nossa. Sem este crivo,
   * `shop=evil.com` faria o servidor mandar o segredo do app para onde quem
   * pediu escolheu — é o caminho inteiro de um SSRF.
   */
  it('domínio que não é da Shopify não passa', async () => {
    for (const shop of ['evil.com', 'loja.myshopify.com.evil.com', '', 'https://']) {
      const resposta = await instalar(pedidoDeInstalacao(shop));
      expect(codigo(resposta), shop).toBe('dominio_invalido');
      expect(gravouSessao, shop).toBeNull();
    }
  });
});

/** Monta o retorno do OAuth, assinado como a Shopify assina. */
function retorno(
  parametros: Record<string, string>,
  cookie: string | null,
  segredo = SEGREDO,
): NextRequest {
  const query = new URLSearchParams(parametros);

  const pares = [...query.entries()]
    .filter(([chave]) => chave !== 'hmac' && chave !== 'signature')
    .map(([chave, valor]) => `${chave}=${valor}`)
    .sort();
  query.set('hmac', createHmac('sha256', segredo).update(pares.join('&')).digest('hex'));

  const requisicao = new NextRequest(
    `https://app.storefy.com.br/api/shopify/callback?${query.toString()}`,
  );
  if (cookie !== null) requisicao.cookies.set(COOKIE_DO_STATE, cookie);
  return requisicao;
}

const STATE = 'state-aleatorio-do-teste';
const COOKIE_BOM = `${STATE}.${ID_DA_LOJA}`;

function parametrosBons(): Record<string, string> {
  return { shop: LOJA, code: 'codigo-da-shopify', state: STATE, timestamp: '1758400000' };
}

describe('GET /api/shopify/callback', () => {
  it('guarda o token CIFRADO e volta para as integrações', async () => {
    const resposta = await retornar(retorno(parametrosBons(), COOKIE_BOM));

    expect(codigo(resposta)).toBe('conectada');
    expect(gravouServico).toMatchObject({
      shop_domain: LOJA,
      platform: 'shopify',
      shopify_scopes: ['read_products', 'read_orders', 'read_customers', 'read_fulfillments'],
    });

    // O token vai cifrado, e o teste olha o valor gravado: um dia alguém
    // "simplifica" isso e o token entra em claro no banco.
    const gravado = String(gravouServico?.shopify_access_token_enc);
    expect(gravado).not.toContain('shpat_do_teste');
    expect(gravado.startsWith('v1.')).toBe(true);
  });

  it('a loja que conectou vira a loja ativa do painel', async () => {
    const resposta = await retornar(retorno(parametrosBons(), COOKIE_BOM));

    expect(resposta.cookies.get('storefy_loja')?.value).toBe(ID_DA_LOJA);
    expect(resposta.cookies.get('storefy_org')?.value).toBe(ID_DA_ORG);
    // E o state é descartado: ele vale uma vez só.
    expect(resposta.cookies.get(COOKIE_DO_STATE)?.value).toBe('');
  });

  /* A assinatura é a prova de que a query veio da Shopify. */
  it('assinatura de outro segredo é recusada', async () => {
    const resposta = await retornar(retorno(parametrosBons(), COOKIE_BOM, 'outro-segredo'));

    expect(codigo(resposta)).toBe('retorno_invalido');
    expect(gravouServico).toBeNull();
  });

  it('parâmetro trocado depois de assinar é recusado', async () => {
    const original = retorno(parametrosBons(), COOKIE_BOM);
    const adulterada = new URL(original.url);
    adulterada.searchParams.set('code', 'outro-codigo');

    const requisicao = new NextRequest(adulterada);
    requisicao.cookies.set(COOKIE_DO_STATE, COOKIE_BOM);

    expect(codigo(await retornar(requisicao))).toBe('retorno_invalido');
    expect(gravouServico).toBeNull();
  });

  /*
   * Sem o cookie, quem não iniciou a conexão não consegue completá-la — é o
   * que impede um retorno forjado de conectar a loja de alguém.
   */
  it('sem o cookie do state, o retorno não vale', async () => {
    expect(codigo(await retornar(retorno(parametrosBons(), null)))).toBe('retorno_invalido');
    expect(gravouServico).toBeNull();
  });

  it('state diferente do guardado é recusado', async () => {
    const resposta = await retornar(retorno(parametrosBons(), `outro-state.${ID_DA_LOJA}`));

    expect(codigo(resposta)).toBe('retorno_invalido');
    expect(gravouServico).toBeNull();
  });

  it('cookie sem a loja é recusado: não dá para saber onde gravar', async () => {
    expect(codigo(await retornar(retorno(parametrosBons(), STATE)))).toBe('retorno_invalido');
    expect(gravouServico).toBeNull();
  });

  it('domínio que não é da Shopify é recusado antes de qualquer chamada', async () => {
    const resposta = await retornar(retorno({ ...parametrosBons(), shop: 'evil.com' }, COOKIE_BOM));

    expect(codigo(resposta)).toBe('retorno_invalido');
    expect(gravouServico).toBeNull();
  });

  it('sem code não há o que trocar', async () => {
    const resposta = await retornar(retorno({ ...parametrosBons(), code: '' }, COOKIE_BOM));

    expect(codigo(resposta)).toBe('retorno_invalido');
  });

  it('falha na troca do code não grava nada', async () => {
    troca = { ok: false, motivo: 'A autorização expirou.' };

    const resposta = await retornar(retorno(parametrosBons(), COOKIE_BOM));

    expect(codigo(resposta)).toBe('token');
    expect(gravouServico).toBeNull();
  });

  /*
   * Escopo a menos guarda o token do mesmo jeito: metade das permissões ainda
   * serve para metade do produto, e a tela diz o que falta.
   */
  it('escopo concedido a menos vira aviso, e não perda da conexão', async () => {
    troca = { ok: true, token: 'shpat_do_teste', escopos: 'read_products' };

    const resposta = await retornar(retorno(parametrosBons(), COOKIE_BOM));

    expect(codigo(resposta)).toBe('escopos');
    expect(gravouServico).toMatchObject({ shopify_scopes: ['read_products'] });
  });

  it('webhook que não registrou vira aviso de conexão parcial', async () => {
    webhooks = { registrados: ['orders/create'], falharam: ['products/update'] };

    expect(codigo(await retornar(retorno(parametrosBons(), COOKIE_BOM)))).toBe('parcial');
  });

  it('erro ao gravar não engana o lojista com um "conectada"', async () => {
    erroDaGravacao = { message: 'coluna não existe' };

    expect(codigo(await retornar(retorno(parametrosBons(), COOKIE_BOM)))).toBe('erro');
  });

  it('sem chave de criptografia o token não é gravado em claro', async () => {
    delete process.env.ENCRYPTION_KEY;

    expect(codigo(await retornar(retorno(parametrosBons(), COOKIE_BOM)))).toBe('nao_configurado');
    expect(gravouServico).toBeNull();
  });
});

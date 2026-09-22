/**
 * Conectar pelo app do próprio lojista, com a Shopify e o banco falsos.
 *
 * O que se prova aqui é a ORDEM e o que ela protege:
 *
 *   nada é gravado antes de a Shopify aceitar as credenciais, senão a tela
 *   diria "conectada" para uma conexão que nunca existiu;
 *
 *   nada é gravado com escopo faltando, senão a loja conecta sem erro e
 *   simplesmente nunca traz pedido — receita zerada sem explicação;
 *
 *   o Client Secret é gravado CIFRADO. Um teste lê o que foi para o banco e
 *   exige que o texto puro não esteja lá.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { descriptografar } from '@/lib/cripto';
import { conectarPeloAppDoLojista, escoposFaltando } from '@/lib/conectar-manual';

const CHAVE = Buffer.alloc(32, 23).toString('base64');
const LOJA = 'oak-vintage.myshopify.com';
const SEGREDO = 'shpss_segredo_do_app';
const ESCOPOS = 'read_products,read_orders,read_customers,read_fulfillments';
const WEBHOOK = 'https://app.exemplo.com/api/webhooks/shopify';

let chaveOriginal: string | undefined;
let escoposOriginal: string | undefined;

beforeEach(() => {
  chaveOriginal = process.env.ENCRYPTION_KEY;
  escoposOriginal = process.env.SHOPIFY_SCOPES;
  process.env.ENCRYPTION_KEY = CHAVE;
  process.env.SHOPIFY_SCOPES = ESCOPOS;
});

afterEach(() => {
  if (chaveOriginal === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = chaveOriginal;
  if (escoposOriginal === undefined) delete process.env.SHOPIFY_SCOPES;
  else process.env.SHOPIFY_SCOPES = escoposOriginal;
});

/** O banco falso: guarda o que foi gravado e quem já ocupa o domínio. */
function bancoFalso(ocupadoPor: string | null = null) {
  const gravado: Record<string, unknown>[] = [];

  const servico = {
    from: () => ({
      select: () => ({
        eq: () => ({
          not: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: ocupadoPor == null ? null : { id: ocupadoPor },
                error: null,
              }),
          }),
        }),
      }),
      update: (valores: Record<string, unknown>) => {
        gravado.push(valores);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  } as never;

  return { servico, gravado };
}

interface OpcoesDaRede {
  escopos?: string;
  status?: number;
  webhookFalha?: boolean;
}

/** O alvo como texto, seja qual for a forma que o fetch aceita. */
function urlDe(url: string | URL | Request): string {
  if (typeof url === 'string') return url;
  return url instanceof URL ? url.toString() : url.url;
}

function redeFalsa(opcoes: OpcoesDaRede = {}) {
  const chamadas: string[] = [];

  const buscador = vi.fn((url: string | URL | Request) => {
    const alvo = urlDe(url);
    chamadas.push(alvo);

    if (alvo.includes('/admin/oauth/access_scopes.json')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_scopes: (opcoes.escopos ?? ESCOPOS).split(',').map((h) => ({ handle: h })),
          }),
          { status: opcoes.status ?? 200 },
        ),
      );
    }

    if (alvo.includes('/admin/oauth/access_token')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'shpat_do_teste',
            scope: opcoes.escopos ?? ESCOPOS,
            expires_in: 86399,
          }),
          { status: opcoes.status ?? 200 },
        ),
      );
    }

    // Registro de webhook.
    return Promise.resolve(
      new Response(JSON.stringify({ webhook: { id: 1 } }), {
        status: opcoes.webhookFalha === true ? 422 : 201,
      }),
    );
  });

  return { buscador: buscador as unknown as typeof fetch, chamadas };
}

const PEDIDO = {
  storeId: 'loja-1',
  dominio: LOJA,
  clientId: 'id-do-app',
  clientSecret: SEGREDO,
};

describe('conectarPeloAppDoLojista', () => {
  it('conecta, grava a conexão e registra os webhooks', async () => {
    const { servico, gravado } = bancoFalso();
    const { buscador, chamadas } = redeFalsa();

    const resultado = await conectarPeloAppDoLojista(servico, PEDIDO, WEBHOOK, buscador);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.dominio).toBe(LOJA);
    expect(resultado.webhooksFalhos).toBe(0);

    expect(gravado).toHaveLength(1);
    const linha = gravado[0] ?? {};
    expect(linha.shopify_conexao).toBe('manual');
    expect(linha.shopify_client_id).toBe('id-do-app');
    expect(linha.shop_domain).toBe(LOJA);

    // A troca vem antes; os webhooks depois. Sete tópicos, uma troca.
    expect(chamadas[0]).toContain('/admin/oauth/access_token');
    expect(chamadas.filter((url) => url.includes('/webhooks.json')).length).toBeGreaterThan(0);
  });

  /*
   * O SEGREDO NÃO PODE ESTAR EM CLARO NO BANCO. É a regra do CLAUDE.md, e é o
   * que separa um vazamento de leitura de um vazamento de acesso às lojas dos
   * clientes.
   */
  it('grava o Client Secret cifrado, e o token também', async () => {
    const { servico, gravado } = bancoFalso();
    const { buscador } = redeFalsa();

    await conectarPeloAppDoLojista(servico, PEDIDO, WEBHOOK, buscador);

    const linha = gravado[0] ?? {};
    const segredo = String(linha.shopify_client_secret_enc);
    const token = String(linha.shopify_access_token_enc);

    expect(segredo).not.toContain(SEGREDO);
    expect(token).not.toContain('shpat_do_teste');
    // Cifrado de verdade, e não apenas embaralhado: abre com a chave.
    expect(descriptografar(segredo)).toBe(SEGREDO);
    expect(descriptografar(token)).toBe('shpat_do_teste');
  });

  it('guarda o prazo do token, para saber quando renovar', async () => {
    const { servico, gravado } = bancoFalso();
    const { buscador } = redeFalsa();

    await conectarPeloAppDoLojista(servico, PEDIDO, WEBHOOK, buscador);

    const prazo = Date.parse(String(gravado[0]?.shopify_token_expires_at));
    expect(prazo).toBeGreaterThan(Date.now());
  });

  /*
   * Um app sem `read_orders` conecta sem erro nenhum e nunca traz pedido. O
   * lojista veria a receita zerada e não teria como saber por quê — por isso
   * a conferência é ANTES de gravar, e a mensagem diz o que adicionar.
   */
  it('escopo faltando recusa a conexão antes de gravar', async () => {
    const { servico, gravado } = bancoFalso();
    const { buscador } = redeFalsa({ escopos: 'read_products,read_customers' });

    const resultado = await conectarPeloAppDoLojista(servico, PEDIDO, WEBHOOK, buscador);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.motivo).toContain('read_orders');
      expect(resultado.motivo).toContain('read_fulfillments');
    }
    expect(gravado).toEqual([]);
  });

  it('credencial recusada pela Shopify não grava nada', async () => {
    const { servico, gravado } = bancoFalso();
    const { buscador } = redeFalsa({ status: 401 });

    expect((await conectarPeloAppDoLojista(servico, PEDIDO, WEBHOOK, buscador)).ok).toBe(false);
    expect(gravado).toEqual([]);
  });

  it('domínio inválido não vira chamada nem gravação', async () => {
    const { servico, gravado } = bancoFalso();
    const { buscador, chamadas } = redeFalsa();

    const resultado = await conectarPeloAppDoLojista(
      servico,
      { ...PEDIDO, dominio: 'evil.com' },
      WEBHOOK,
      buscador,
    );

    expect(resultado.ok).toBe(false);
    expect(chamadas).toEqual([]);
    expect(gravado).toEqual([]);
  });

  it('o lojista pode digitar só o nome da loja', async () => {
    const { servico } = bancoFalso();
    const { buscador } = redeFalsa();

    const resultado = await conectarPeloAppDoLojista(
      servico,
      { ...PEDIDO, dominio: '  Oak-Vintage  ' },
      WEBHOOK,
      buscador,
    );

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dominio).toBe(LOJA);
  });

  /*
   * A mesma loja conectada em dois lugares deixa o webhook sem dono: a rota
   * não saberia com qual segredo conferir, e os pedidos cairiam num dos dois
   * apps por sorteio.
   */
  it('loja já conectada em outra loja do painel é recusada', async () => {
    const { servico, gravado } = bancoFalso('outra-loja');
    const { buscador, chamadas } = redeFalsa();

    const resultado = await conectarPeloAppDoLojista(servico, PEDIDO, WEBHOOK, buscador);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.motivo).toContain('já está conectada');
    expect(chamadas).toEqual([]);
    expect(gravado).toEqual([]);
  });

  /* Reconectar a MESMA loja precisa continuar funcionando. */
  it('reconectar a própria loja não é bloqueado', async () => {
    const { servico, gravado } = bancoFalso('loja-1');
    const { buscador } = redeFalsa();

    expect((await conectarPeloAppDoLojista(servico, PEDIDO, WEBHOOK, buscador)).ok).toBe(true);
    expect(gravado).toHaveLength(1);
  });

  /*
   * Um tópico que falhou é um aviso a menos, não uma conexão quebrada: a
   * conexão fica de pé e a tela diz que faltaram. Recusar tudo aqui deixaria
   * o lojista sem integração por causa de um aviso.
   */
  it('webhook que falha não derruba a conexão, e é contado', async () => {
    const { servico, gravado } = bancoFalso();
    const { buscador } = redeFalsa({ webhookFalha: true });

    const resultado = await conectarPeloAppDoLojista(servico, PEDIDO, WEBHOOK, buscador);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.webhooksFalhos).toBeGreaterThan(0);
    expect(gravado).toHaveLength(1);
  });

  it('campo em branco vira mensagem, e não chamada', async () => {
    const { servico } = bancoFalso();
    const { buscador, chamadas } = redeFalsa();

    for (const pedido of [
      { ...PEDIDO, clientId: '  ' },
      { ...PEDIDO, clientSecret: '' },
    ]) {
      expect((await conectarPeloAppDoLojista(servico, pedido, WEBHOOK, buscador)).ok).toBe(false);
    }
    expect(chamadas).toEqual([]);
  });
});

describe('escoposFaltando', () => {
  it('lista o que o app do lojista não tem', () => {
    expect(escoposFaltando(['read_products'])).toEqual([
      'read_orders',
      'read_customers',
      'read_fulfillments',
    ]);
  });

  it('nada falta quando o app tem tudo — e sobrar não é problema', () => {
    expect(escoposFaltando(ESCOPOS.split(','))).toEqual([]);
    expect(escoposFaltando([...ESCOPOS.split(','), 'write_products'])).toEqual([]);
  });
});

/*
 * O outro tipo de app personalizado: o criado DENTRO do admin da loja. Ele
 * mostra um token pronto e recusa `client_credentials`. Aceitá-lo é o que
 * evita mandar o lojista refazer o app no lugar certo.
 */
describe('conectarPeloAppDoLojista, com token de acesso em mãos', () => {
  const COM_TOKEN = { ...PEDIDO, token: 'shpat_do_admin' };

  it('usa o token e NÃO tenta a troca por credenciais', async () => {
    const { servico, gravado } = bancoFalso();
    const { buscador, chamadas } = redeFalsa();

    const resultado = await conectarPeloAppDoLojista(servico, COM_TOKEN, WEBHOOK, buscador);

    expect(resultado.ok).toBe(true);

    // A troca nem é tentada: o app que mostra token é o que a recusa.
    expect(chamadas.some((url) => url.includes('/admin/oauth/access_token'))).toBe(false);
    expect(chamadas[0]).toContain('/admin/oauth/access_scopes.json');

    expect(descriptografar(String(gravado[0]?.shopify_access_token_enc))).toBe('shpat_do_admin');
  });

  /* Este token não vence: prazo nulo é o que impede a renovação inútil. */
  it('grava sem prazo de validade', async () => {
    const { servico, gravado } = bancoFalso();
    const { buscador } = redeFalsa();

    await conectarPeloAppDoLojista(servico, COM_TOKEN, WEBHOOK, buscador);

    expect(gravado[0]?.shopify_token_expires_at).toBeNull();
  });

  /* O Client Secret continua obrigatório: é ele que assina os webhooks. */
  it('ainda exige o Client Secret, que é quem confere o webhook', async () => {
    const { servico, gravado } = bancoFalso();
    const { buscador, chamadas } = redeFalsa();

    const resultado = await conectarPeloAppDoLojista(
      servico,
      { ...COM_TOKEN, clientSecret: '' },
      WEBHOOK,
      buscador,
    );

    expect(resultado.ok).toBe(false);
    expect(chamadas).toEqual([]);
    expect(gravado).toEqual([]);
  });

  it('escopo faltando recusa também por este caminho', async () => {
    const { servico, gravado } = bancoFalso();
    const { buscador } = redeFalsa({ escopos: 'read_products' });

    const resultado = await conectarPeloAppDoLojista(servico, COM_TOKEN, WEBHOOK, buscador);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.motivo).toContain('read_orders');
    expect(gravado).toEqual([]);
  });
});

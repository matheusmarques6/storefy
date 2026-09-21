/**
 * O token da loja, com o prazo que a conexão manual tem.
 *
 * O risco aqui é de madrugada: o token vale 24 horas, e uma renovação que não
 * acontece — ou que acontece e não é gravada — vira "a integração parou
 * sozinha" sem ninguém ter mexido em nada.
 *
 * O outro risco é de gravar errado: renovar e não persistir faria TODA chamada
 * renovar, e a Shopify limita isso.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criptografar, descriptografar } from '@/lib/cripto';
import { segredoDoWebhook, tokenDaLoja } from '@/lib/shopify-conexao';

const CHAVE = Buffer.alloc(32, 29).toString('base64');
const LOJA = 'oak-vintage.myshopify.com';
const SEGREDO_DA_STOREFY = 'segredo-do-app-publico';

let chaveOriginal: string | undefined;
let segredoOriginal: string | undefined;

beforeEach(() => {
  chaveOriginal = process.env.ENCRYPTION_KEY;
  segredoOriginal = process.env.SHOPIFY_API_SECRET;
  process.env.ENCRYPTION_KEY = CHAVE;
  process.env.SHOPIFY_API_SECRET = SEGREDO_DA_STOREFY;
});

afterEach(() => {
  if (chaveOriginal === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = chaveOriginal;
  if (segredoOriginal === undefined) delete process.env.SHOPIFY_API_SECRET;
  else process.env.SHOPIFY_API_SECRET = segredoOriginal;
});

type Linha = Record<string, unknown> | null;

function bancoFalso(linha: Linha) {
  const gravado: Record<string, unknown>[] = [];

  const servico = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: linha, error: null }),
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

/** O alvo como texto, seja qual for a forma que o fetch aceita. */
function urlDe(url: string | URL | Request): string {
  if (typeof url === 'string') return url;
  return url instanceof URL ? url.toString() : url.url;
}

function redeFalsa(token = 'shpat_novinho') {
  const chamadas: string[] = [];
  const buscador = vi.fn((url: string | URL | Request) => {
    chamadas.push(urlDe(url));
    return Promise.resolve(
      new Response(
        JSON.stringify({ access_token: token, scope: 'read_orders', expires_in: 86399 }),
        { status: 200 },
      ),
    );
  });
  return { buscador: buscador as unknown as typeof fetch, chamadas };
}

/** Uma linha de loja conectada, com o prazo que se quiser. */
function loja(ajustes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'loja-1',
    shop_domain: LOJA,
    shopify_access_token_enc: criptografar('shpat_antigo'),
    shopify_conexao: 'manual',
    shopify_client_id: 'id-do-app',
    shopify_client_secret_enc: criptografar('shpss_segredo'),
    shopify_token_expires_at: new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
    ...ajustes,
  };
}

describe('tokenDaLoja', () => {
  it('devolve o token guardado quando ele ainda tem prazo', async () => {
    const { servico, gravado } = bancoFalso(loja());
    const { buscador, chamadas } = redeFalsa();

    const resultado = await tokenDaLoja(servico, 'loja-1', buscador);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.token).toBe('shpat_antigo');
    // Sem prazo curto, sem chamada e sem gravação.
    expect(chamadas).toEqual([]);
    expect(gravado).toEqual([]);
  });

  /* Conexão por OAuth não tem prazo: o token dela vale até a desinstalação. */
  it('conexão sem prazo nunca renova', async () => {
    const { servico } = bancoFalso(
      loja({ shopify_conexao: 'oauth', shopify_token_expires_at: null }),
    );
    const { buscador, chamadas } = redeFalsa();

    const resultado = await tokenDaLoja(servico, 'loja-1', buscador);

    expect(resultado.ok).toBe(true);
    expect(chamadas).toEqual([]);
  });

  it('token vencido é renovado, devolvido e GRAVADO', async () => {
    const { servico, gravado } = bancoFalso(
      loja({ shopify_token_expires_at: new Date(Date.now() - 1000).toISOString() }),
    );
    const { buscador, chamadas } = redeFalsa();

    const resultado = await tokenDaLoja(servico, 'loja-1', buscador);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.token).toBe('shpat_novinho');

    expect(chamadas[0]).toContain('/admin/oauth/access_token');

    /*
     * Gravar é o que impede a renovação de virar rotina: sem isto, toda
     * chamada renovaria, e a Shopify limita a frequência.
     */
    expect(gravado).toHaveLength(1);
    const linha = gravado[0] ?? {};
    expect(descriptografar(String(linha.shopify_access_token_enc))).toBe('shpat_novinho');
    expect(Date.parse(String(linha.shopify_token_expires_at))).toBeGreaterThan(Date.now());
  });

  /*
   * O lojista pode ter mexido nas permissões do app dele entre uma renovação e
   * outra. Reler os escopos é o que faz a tela mostrar o que vale agora.
   */
  it('a renovação atualiza os escopos', async () => {
    const { servico, gravado } = bancoFalso(
      loja({ shopify_token_expires_at: new Date(Date.now() - 1000).toISOString() }),
    );
    const { buscador } = redeFalsa();

    await tokenDaLoja(servico, 'loja-1', buscador);

    expect(gravado[0]?.shopify_scopes).toEqual(['read_orders']);
  });

  it('loja desconectada pede conexão, sem chamar a rede', async () => {
    const { servico } = bancoFalso(loja({ shopify_access_token_enc: null }));
    const { buscador, chamadas } = redeFalsa();

    const resultado = await tokenDaLoja(servico, 'loja-1', buscador);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.reconectar).toBe(true);
    expect(chamadas).toEqual([]);
  });

  it('loja que não existe não estoura', async () => {
    const { servico } = bancoFalso(null);
    const { buscador } = redeFalsa();

    expect((await tokenDaLoja(servico, 'loja-1', buscador)).ok).toBe(false);
  });

  /*
   * Prazo sem credencial para renovar só pode vir de uma linha mexida à mão —
   * o banco recusa `manual` sem as duas colunas. Ainda assim precisa virar
   * "reconecte", e não uma exceção.
   */
  it('prazo vencido sem credencial pede reconexão', async () => {
    const { servico } = bancoFalso(
      loja({
        shopify_token_expires_at: new Date(Date.now() - 1000).toISOString(),
        shopify_client_id: null,
        shopify_client_secret_enc: null,
      }),
    );
    const { buscador, chamadas } = redeFalsa();

    const resultado = await tokenDaLoja(servico, 'loja-1', buscador);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.reconectar).toBe(true);
    expect(chamadas).toEqual([]);
  });

  it('credencial recusada na renovação vira "reconecte"', async () => {
    const { servico, gravado } = bancoFalso(
      loja({ shopify_token_expires_at: new Date(Date.now() - 1000).toISOString() }),
    );
    const buscador = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 })),
    );

    const resultado = await tokenDaLoja(servico, 'loja-1', buscador);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.reconectar).toBe(true);
    // Nada é gravado: o token velho continua lá, e reconectar conserta.
    expect(gravado).toEqual([]);
  });

  /* Chave de criptografia trocada: o que está guardado não abre mais. */
  it('token que não abre pede reconexão', async () => {
    const { servico } = bancoFalso(loja({ shopify_access_token_enc: 'lixo' }));
    const { buscador } = redeFalsa();

    const resultado = await tokenDaLoja(servico, 'loja-1', buscador);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.reconectar).toBe(true);
  });
});

describe('segredoDoWebhook', () => {
  it('loja manual assina com o segredo do app dela', async () => {
    const { servico } = bancoFalso({
      shopify_conexao: 'manual',
      shopify_client_secret_enc: criptografar('shpss_da_loja'),
    });

    expect(await segredoDoWebhook(servico, LOJA)).toBe('shpss_da_loja');
  });

  it('loja por OAuth assina com o segredo da Storefy', async () => {
    const { servico } = bancoFalso({
      shopify_conexao: 'oauth',
      shopify_client_secret_enc: null,
    });

    expect(await segredoDoWebhook(servico, LOJA)).toBe(SEGREDO_DA_STOREFY);
  });

  /*
   * Loja desconhecida existe de verdade: é a que ACABOU de instalar o app
   * público e ainda não tem linha, e é a que desinstalou — cujo
   * `app/uninstalled` é justamente o webhook que está chegando.
   */
  it('loja desconhecida cai no segredo da Storefy', async () => {
    const { servico } = bancoFalso(null);

    expect(await segredoDoWebhook(servico, LOJA)).toBe(SEGREDO_DA_STOREFY);
  });

  /*
   * ESTE É O CASO QUE IMPORTA: uma loja manual NUNCA volta ao segredo da
   * Storefy. Voltar aceitaria como boa uma assinatura que ela não produz, e
   * devolveria a uma chave só o poder de falar por todas as lojas.
   */
  it('loja manual sem segredo legível não volta ao segredo da Storefy', async () => {
    for (const enc of ['lixo-que-nao-abre', null, '']) {
      const { servico } = bancoFalso({
        shopify_conexao: 'manual',
        shopify_client_secret_enc: enc,
      });

      expect(await segredoDoWebhook(servico, LOJA), String(enc)).toBeNull();
    }
  });

  it('sem SHOPIFY_API_SECRET, a loja por OAuth não tem segredo nenhum', async () => {
    delete process.env.SHOPIFY_API_SECRET;
    const { servico } = bancoFalso({ shopify_conexao: 'oauth', shopify_client_secret_enc: null });

    expect(await segredoDoWebhook(servico, LOJA)).toBeNull();
  });
});

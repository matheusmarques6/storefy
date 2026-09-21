/**
 * A troca de credenciais por token, com a Shopify falsa.
 *
 * O que se prova aqui é a TRADUÇÃO: cada recusa da Shopify precisa virar uma
 * frase que diz ao lojista o que fazer. "401 Unauthorized" na tela é um
 * chamado no suporte; "copie o Client Secret de novo" é um problema resolvido
 * sozinho.
 *
 * E se prova o prazo: o token vale 24 horas, e errar a conta de quando ele
 * vence é a integração parando sozinha de madrugada.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  FOLGA_DA_RENOVACAO_MS,
  lerResposta,
  precisaRenovar,
  trocarCredenciaisPorToken,
} from '@/lib/shopify-credenciais';

const LOJA = 'oak-vintage.myshopify.com';
const ESCOPOS = 'read_products,read_orders,read_customers,read_fulfillments';

/** O alvo como texto, seja qual for a forma que o fetch aceita. */
function urlDe(url: string | URL | Request): string {
  if (typeof url === 'string') return url;
  return url instanceof URL ? url.toString() : url.url;
}

function rede(corpo: unknown, status = 200) {
  const chamadas: { url: string; corpo: string }[] = [];

  const buscador = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: urlDe(url), corpo: typeof init?.body === 'string' ? init.body : '' });
    return Promise.resolve(
      new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status }),
    );
  });

  return { buscador: buscador as unknown as typeof fetch, chamadas };
}

const OK = { access_token: 'shpat_do_teste', scope: ESCOPOS, expires_in: 86399 };

describe('trocarCredenciaisPorToken', () => {
  it('troca as credenciais e devolve token, escopos e prazo', async () => {
    const { buscador, chamadas } = rede(OK);
    const antes = Date.now();

    const troca = await trocarCredenciaisPorToken(LOJA, 'id-do-app', 'segredo', buscador);

    expect(troca.ok).toBe(true);
    if (!troca.ok) return;

    expect(troca.valor.token).toBe('shpat_do_teste');
    expect(troca.valor.escopos).toEqual(ESCOPOS.split(','));

    // 86399 segundos à frente, com folga para o tempo que o teste levou.
    const prazo = Date.parse(troca.valor.venceEm);
    expect(prazo).toBeGreaterThanOrEqual(antes + 86_399_000);
    expect(prazo).toBeLessThan(antes + 86_399_000 + 5000);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe(`https://${LOJA}/admin/oauth/access_token`);
    expect(chamadas[0]?.corpo).toContain('grant_type=client_credentials');
  });

  /*
   * O domínio vira o HOST de uma chamada que leva o segredo do app do lojista.
   * Sem o crivo, `evil.com` faria o servidor entregar a credencial dele a quem
   * escolheu o endereço — o caminho inteiro de um SSRF.
   */
  it('domínio que não é de loja Shopify não vira chamada nenhuma', async () => {
    const { buscador, chamadas } = rede(OK);

    const troca = await trocarCredenciaisPorToken('evil.com', 'id', 'segredo', buscador);

    expect(troca.ok).toBe(false);
    expect(chamadas).toEqual([]);
  });

  it('credencial em branco não vira chamada nenhuma', async () => {
    const { buscador, chamadas } = rede(OK);

    for (const [id, segredo] of [
      ['', 'segredo'],
      ['id', ''],
      ['   ', '   '],
    ]) {
      expect((await trocarCredenciaisPorToken(LOJA, id ?? '', segredo ?? '', buscador)).ok).toBe(
        false,
      );
    }
    expect(chamadas).toEqual([]);
  });

  /*
   * Os dois erros que o lojista vai encontrar de verdade, e que a Shopify
   * devolve de formas diferentes. Confundi-los manda ele conferir a
   * credencial certa achando que a digitou errado.
   */
  it('401 vira "confira as credenciais"', async () => {
    const { buscador } = rede({ error: 'invalid_client' }, 401);
    const troca = await trocarCredenciaisPorToken(LOJA, 'id', 'errado', buscador);

    expect(troca.ok).toBe(false);
    if (!troca.ok) expect(troca.motivo).toContain('não conferem');
  });

  it('app não instalado vira "instale o app na loja"', async () => {
    const { buscador } = rede({ error: 'application_cannot_be_found' }, 400);
    const troca = await trocarCredenciaisPorToken(LOJA, 'id', 'segredo', buscador);

    expect(troca.ok).toBe(false);
    if (!troca.ok) expect(troca.motivo).toContain('instalado');
  });

  it('a Shopify fora do ar vira "tente de novo", e não "confira a credencial"', async () => {
    const { buscador } = rede('', 503);
    const troca = await trocarCredenciaisPorToken(LOJA, 'id', 'segredo', buscador);

    expect(troca.ok).toBe(false);
    if (!troca.ok) expect(troca.motivo).toContain('fora do ar');
  });

  /* O corpo cru serve ao suporte, não ao lojista, e não pode escapar. */
  it('o corpo do erro da Shopify nunca chega à mensagem', async () => {
    const { buscador } = rede({ error_description: 'client_secret=abc123 inválido' }, 400);
    const troca = await trocarCredenciaisPorToken(LOJA, 'id', 'segredo', buscador);

    expect(troca.ok).toBe(false);
    if (!troca.ok) expect(troca.motivo).not.toContain('abc123');
  });

  it('rede fora do ar não estoura', async () => {
    const buscador = vi.fn(() => Promise.reject(new Error('sem rede')));
    const troca = await trocarCredenciaisPorToken(LOJA, 'id', 'segredo', buscador);

    expect(troca.ok).toBe(false);
  });
});

describe('lerResposta', () => {
  it('resposta sem token é recusada', () => {
    expect(lerResposta({ scope: ESCOPOS, expires_in: 86399 }).ok).toBe(false);
    expect(lerResposta({ access_token: '   ' }).ok).toBe(false);
    expect(lerResposta(null).ok).toBe(false);
    expect(lerResposta('não é json').ok).toBe(false);
  });

  /*
   * `expires_in` já veio número e já veio texto da Shopify, e `Number('')` é
   * 0 — um token que nasceria vencido e faria toda chamada renovar.
   */
  it('prazo ausente ou estranho vira um padrão curto, nunca zero', () => {
    for (const expires of [undefined, '', 'muito tempo', 0, -1, null]) {
      const lido = lerResposta({ access_token: 'shpat_x', expires_in: expires });

      expect(lido.ok, String(expires)).toBe(true);
      if (!lido.ok) continue;
      expect(Date.parse(lido.valor.venceEm), String(expires)).toBeGreaterThan(Date.now());
    }
  });

  it('prazo em texto é aceito, porque a Shopify já mandou assim', () => {
    const lido = lerResposta({ access_token: 'shpat_x', expires_in: '86399' });

    expect(lido.ok).toBe(true);
    if (lido.ok) {
      expect(Date.parse(lido.valor.venceEm)).toBeGreaterThan(Date.now() + 86_000_000);
    }
  });

  it('sem escopos na resposta, a lista fica vazia em vez de estourar', () => {
    const lido = lerResposta({ access_token: 'shpat_x' });

    expect(lido.ok).toBe(true);
    if (lido.ok) expect(lido.valor.escopos).toEqual([]);
  });
});

describe('precisaRenovar', () => {
  const agora = Date.parse('2026-09-21T12:00:00Z');
  const daqui = (ms: number): string => new Date(agora + ms).toISOString();

  /* Sem prazo é conexão por OAuth: o token dela não vence. */
  it('conexão sem prazo nunca renova', () => {
    expect(precisaRenovar(null, agora)).toBe(false);
    expect(precisaRenovar('', agora)).toBe(false);
  });

  it('token com folga de sobra não renova', () => {
    expect(precisaRenovar(daqui(FOLGA_DA_RENOVACAO_MS + 60_000), agora)).toBe(false);
  });

  /*
   * A folga existe porque renovar no instante do vencimento é renovar tarde: a
   * chamada que dispara a renovação é a mesma que vai usar o token, e um token
   * que vence no meio dela falha do mesmo jeito.
   */
  it('token dentro da folga renova antes de ser usado', () => {
    expect(precisaRenovar(daqui(FOLGA_DA_RENOVACAO_MS - 1000), agora)).toBe(true);
  });

  it('token já vencido renova', () => {
    expect(precisaRenovar(daqui(-1000), agora)).toBe(true);
  });

  /* Renovar à toa custa uma chamada; não renovar custa a integração parada. */
  it('data ilegível é tratada como vencida', () => {
    expect(precisaRenovar('amanhã de manhã', agora)).toBe(true);
  });
});

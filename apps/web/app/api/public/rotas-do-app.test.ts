/**
 * As duas rotas que o app escreve, exercitadas de ponta a ponta.
 *
 * `lib/endpoint-do-app.test.ts` prova a decisão; aqui se prova a LIGAÇÃO —
 * que o corpo é lido como texto (e não parseado antes de conferir a
 * assinatura), que o cabeçalho certo é consultado, que o status sai no HTTP e
 * que nenhuma exceção escapa como HTML. Foi por não testar a ligação que a
 * rota pública da config já devolveu a página de erro do Next para o app de
 * todo cliente.
 *
 * O Supabase é substituído porque a rede para `*.supabase.co` não existe neste
 * ambiente; o que está sendo testado aqui é a rota, não o driver.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import { assinar } from '@/lib/assinatura';
import { criptografar } from '@/lib/cripto';

const CHAVE = Buffer.alloc(32, 5).toString('base64');
const SEGREDO = 'segredo-do-app-de-teste';
const APP = '44444444-4444-4444-8444-444444444444';
const DEVICE = '55555555-5555-4555-8555-555555555555';
const EVENTO = '66666666-6666-4666-8666-666666666666';

/** O que a função do Postgres vai responder neste teste. */
let retornoDaRpc: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};
/** O que a consulta do segredo vai responder. */
let segredoNoBanco: string | null = null;
/** Os argumentos com que a RPC foi chamada, para conferir a tradução. */
let argumentosDaRpc: Record<string, unknown> | null = null;

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave-de-teste',
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: segredoNoBanco === null ? null : { device_secret_enc: segredoNoBanco },
              error: null,
            }),
        }),
      }),
    }),
    rpc: (_nome: string, args: Record<string, unknown>) => {
      argumentosDaRpc = args;
      return Promise.resolve(retornoDaRpc);
    },
  }),
}));

const { POST: postarAparelho } = await import('@/app/api/public/devices/route');
const { POST: postarEvento } = await import('@/app/api/public/events/route');

let chaveOriginal: string | undefined;
let avisos: MockInstance<typeof console.warn>;

beforeEach(() => {
  chaveOriginal = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = CHAVE;
  segredoNoBanco = criptografar(SEGREDO);
  argumentosDaRpc = null;
  // O motivo da recusa vai para o log de propósito; o teste não precisa vê-lo.
  avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  if (chaveOriginal === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = chaveOriginal;
  avisos.mockRestore();
});

/** Uma requisição igual à que o app manda, já assinada. */
function requisicao(caminho: string, corpo: string, assinatura: string | null): NextRequest {
  const cabecalhos = new Headers({ 'Content-Type': 'application/json' });
  if (assinatura !== null) cabecalhos.set('x-storefy-signature', assinatura);
  return new NextRequest(`https://app.storefy.com.br${caminho}`, {
    method: 'POST',
    headers: cabecalhos,
    body: corpo,
  });
}

/** Assina o corpo com o segredo certo e o relógio de agora. */
function assinado(corpo: string): string {
  return assinar(SEGREDO, Date.now(), corpo);
}

describe('POST /api/public/devices', () => {
  const corpo = JSON.stringify({
    appId: APP,
    subscriptionId: 'inscricao-1',
    platform: 'android',
    appVersion: '1.0.0',
  });

  it('registra o aparelho e devolve o id', async () => {
    retornoDaRpc = {
      data: [{ device_id: DEVICE, limitado: false, novo: true, boas_vindas: true }],
      error: null,
    };

    const resposta = await postarAparelho(
      requisicao('/api/public/devices', corpo, assinado(corpo)),
    );

    expect(resposta.status).toBe(200);
    await expect(resposta.json()).resolves.toEqual({
      deviceId: DEVICE,
      novo: true,
      boasVindas: true,
    });
    expect(resposta.headers.get('Cache-Control')).toBe('no-store');
  });

  it('traduz os campos do corpo para os argumentos da função', async () => {
    retornoDaRpc = {
      data: [{ device_id: DEVICE, limitado: false, novo: false, boas_vindas: false }],
      error: null,
    };

    await postarAparelho(requisicao('/api/public/devices', corpo, assinado(corpo)));

    expect(argumentosDaRpc).toEqual({
      p_app_id: APP,
      p_subscription: 'inscricao-1',
      p_platform: 'android',
      p_app_version: '1.0.0',
      p_external_id: undefined,
      p_email_hash: undefined,
    });
  });

  it('devolve 401 sem assinatura, e nem chega ao banco', async () => {
    argumentosDaRpc = null;
    const resposta = await postarAparelho(requisicao('/api/public/devices', corpo, null));

    expect(resposta.status).toBe(401);
    await expect(resposta.json()).resolves.toEqual({ erro: 'nao_autorizado' });
    expect(argumentosDaRpc).toBeNull();
  });

  /*
   * O corpo é assinado como TEXTO. Se a rota parseasse antes de conferir,
   * trocar `appId` por outro passaria — e seria escrever na loja alheia.
   */
  it('devolve 401 quando o corpo é trocado depois de assinado', async () => {
    const assinatura = assinar(SEGREDO, Date.now(), corpo);
    const outro = JSON.stringify({
      appId: '77777777-7777-4777-8777-777777777777',
      subscriptionId: 'inscricao-1',
      platform: 'android',
      appVersion: '1.0.0',
    });

    const resposta = await postarAparelho(requisicao('/api/public/devices', outro, assinatura));
    expect(resposta.status).toBe(401);
  });

  it('devolve 429 quando o limite estourou', async () => {
    retornoDaRpc = {
      data: [{ device_id: null, limitado: true, novo: false, boas_vindas: false }],
      error: null,
    };

    const resposta = await postarAparelho(
      requisicao('/api/public/devices', corpo, assinado(corpo)),
    );
    expect(resposta.status).toBe(429);
  });

  it('devolve 503 em JSON quando o banco falha, nunca HTML', async () => {
    retornoDaRpc = { data: null, error: { message: 'conexão caiu' } };

    const resposta = await postarAparelho(
      requisicao('/api/public/devices', corpo, assinado(corpo)),
    );

    expect(resposta.status).toBe(503);
    expect(resposta.headers.get('Content-Type')).toContain('application/json');
    await expect(resposta.json()).resolves.toEqual({ erro: 'indisponivel' });
  });

  it('não repete a mensagem do banco para quem chamou', async () => {
    retornoDaRpc = { data: null, error: { message: 'relation "devices" does not exist' } };

    const resposta = await postarAparelho(
      requisicao('/api/public/devices', corpo, assinado(corpo)),
    );
    const texto = await resposta.text();

    expect(texto).not.toContain('devices');
    expect(texto).not.toContain('relation');
  });

  it('devolve 401 quando o app ainda não tem segredo', async () => {
    segredoNoBanco = null;
    const resposta = await postarAparelho(
      requisicao('/api/public/devices', corpo, assinado(corpo)),
    );
    expect(resposta.status).toBe(401);
  });
});

describe('POST /api/public/events', () => {
  const corpo = JSON.stringify({
    appId: APP,
    subscriptionId: 'inscricao-1',
    event: 'add',
    itemCount: 3,
    cartToken: 'token-do-carrinho',
    valueCents: 12_900,
    currency: 'BRL',
  });

  it('grava o evento e diz que agendou', async () => {
    retornoDaRpc = {
      data: [{ event_id: EVENTO, limitado: false, agendou: true, cancelou: 0 }],
      error: null,
    };

    const resposta = await postarEvento(requisicao('/api/public/events', corpo, assinado(corpo)));

    expect(resposta.status).toBe(200);
    await expect(resposta.json()).resolves.toEqual({
      eventId: EVENTO,
      agendou: true,
      cancelou: 0,
    });
  });

  it('traduz os campos do carrinho para os argumentos da função', async () => {
    retornoDaRpc = {
      data: [{ event_id: EVENTO, limitado: false, agendou: false, cancelou: 1 }],
      error: null,
    };

    await postarEvento(requisicao('/api/public/events', corpo, assinado(corpo)));

    expect(argumentosDaRpc).toEqual({
      p_app_id: APP,
      p_subscription: 'inscricao-1',
      p_event: 'add',
      p_item_count: 3,
      p_cart_token: 'token-do-carrinho',
      p_value_cents: 12_900,
      p_currency: 'BRL',
    });
  });

  it('aceita o mínimo que o observador de carrinho manda', async () => {
    const magro = JSON.stringify({
      appId: APP,
      subscriptionId: 'inscricao-1',
      event: 'update',
      itemCount: 0,
    });
    retornoDaRpc = {
      data: [{ event_id: EVENTO, limitado: false, agendou: false, cancelou: 1 }],
      error: null,
    };

    const resposta = await postarEvento(requisicao('/api/public/events', magro, assinado(magro)));
    expect(resposta.status).toBe(200);
  });

  it('devolve 400 com os campos errados quando o app manda torto', async () => {
    const torto = JSON.stringify({ appId: APP, subscriptionId: 'x', event: 'devolvido' });
    const resposta = await postarEvento(requisicao('/api/public/events', torto, assinado(torto)));

    expect(resposta.status).toBe(400);
    const corpoDaResposta = (await resposta.json()) as { erro: string; campos: string[] };
    expect(corpoDaResposta.erro).toBe('corpo_invalido');
    expect(corpoDaResposta.campos).toEqual(expect.arrayContaining(['event', 'itemCount']));
  });
});

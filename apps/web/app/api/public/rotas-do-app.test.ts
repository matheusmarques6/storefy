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
const { POST: postarErro } = await import('@/app/api/public/errors/route');
const { POST: postarPareamento } = await import('@/app/api/public/test-device/route');
const { POST: postarAbertura } = await import('@/app/api/public/push-opened/route');

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

  it('o app sem push manda só a instalação, e ela vira o argumento da função', async () => {
    retornoDaRpc = {
      data: [{ device_id: DEVICE, limitado: false, novo: true, boas_vindas: false }],
      error: null,
    };
    const semPush = JSON.stringify({
      appId: APP,
      installId: '3f6c1a2e-8d4b-4c7a-9e10-5b2f8a7c6d41',
      platform: 'android',
    });

    const resposta = await postarAparelho(
      requisicao('/api/public/devices', semPush, assinado(semPush)),
    );

    expect(resposta.status).toBe(200);
    expect(argumentosDaRpc).toMatchObject({
      p_app_id: APP,
      p_install_id: '3f6c1a2e-8d4b-4c7a-9e10-5b2f8a7c6d41',
      p_platform: 'android',
    });
    expect(argumentosDaRpc?.p_subscription).toBeUndefined();
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

describe('POST /api/public/errors', () => {
  const DSN = 'https://abc@o1.ingest.sentry.io/99';
  const dsnOriginal = process.env.SENTRY_DSN;
  /** Os envelopes que chegaram ao "Sentry". */
  let enviados: string[] = [];

  const corpo = JSON.stringify({
    appId: APP,
    tipo: 'TypeError',
    mensagem: 'undefined is not an object',
    pilha: 'TypeError: undefined is not an object\n    at abrir (address at main.jsbundle:1:42)',
    fatal: true,
    platform: 'ios',
    appVersion: '1.2.0',
  });

  beforeEach(() => {
    process.env.SENTRY_DSN = DSN;
    enviados = [];
    retornoDaRpc = { data: true, error: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        enviados.push(typeof init?.body === 'string' ? init.body : '');
        return await Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (dsnOriginal === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = dsnOriginal;
  });

  /** O evento que foi para o Sentry: a terceira linha do envelope. */
  function evento(): {
    level: string;
    tags: Record<string, string>;
    exception: { values: { type: string; value: string; stacktrace?: { frames: unknown[] } }[] };
  } {
    return JSON.parse(enviados[0]?.split('\n')[2] ?? '{}') as ReturnType<typeof evento>;
  }

  it('segue para o Sentry com o app, a plataforma, a versão e se foi fatal', async () => {
    const resposta = await postarErro(requisicao('/api/public/errors', corpo, assinado(corpo)));

    expect(resposta.status).toBe(202);
    await expect(resposta.json()).resolves.toEqual({ recebido: true });
    expect(argumentosDaRpc).toEqual({
      p_chave: `app-erros:${APP}`,
      p_maximo: 100,
      p_janela_segundos: 3600,
    });
    expect(enviados).toHaveLength(1);
    expect(evento().level).toBe('error');
    expect(evento().tags).toMatchObject({
      origem: 'app',
      app: APP,
      plataforma: 'ios',
      versao: '1.2.0',
      fatal: 'true',
    });
    // A pilha é a do app, e não a desta rota.
    expect(evento().exception.values[0]).toMatchObject({
      type: 'TypeError',
      value: 'undefined is not an object',
      stacktrace: { frames: [{ function: 'abrir', filename: 'main.jsbundle' }] },
    });
  });

  it('erro que não derrubou o app vai como aviso', async () => {
    const leve = JSON.stringify({
      appId: APP,
      tipo: 'Error',
      mensagem: 'falhou ao ler a config salva',
      fatal: false,
      platform: 'android',
    });
    await postarErro(requisicao('/api/public/errors', leve, assinado(leve)));

    expect(evento().level).toBe('warning');
    expect(evento().tags).toMatchObject({ plataforma: 'android', fatal: 'false' });
    expect(evento().tags).not.toHaveProperty('versao');
  });

  it('sem Sentry configurado, 202 sem abrir o banco nem mandar nada', async () => {
    delete process.env.SENTRY_DSN;
    const resposta = await postarErro(requisicao('/api/public/errors', corpo, assinado(corpo)));

    expect(resposta.status).toBe(202);
    await expect(resposta.json()).resolves.toEqual({ recebido: false });
    expect(argumentosDaRpc).toBeNull();
    expect(enviados).toEqual([]);
  });

  it('401 sem assinatura, ou com o corpo trocado: nada chega ao Sentry', async () => {
    expect((await postarErro(requisicao('/api/public/errors', corpo, null))).status).toBe(401);

    const trocado = corpo.replace('undefined is not an object', 'qualquer coisa');
    const outra = await postarErro(requisicao('/api/public/errors', trocado, assinado(corpo)));
    expect(outra.status).toBe(401);

    expect(argumentosDaRpc).toBeNull();
    expect(enviados).toEqual([]);
  });

  it('400 com os campos errados quando o corpo vem torto', async () => {
    const torto = JSON.stringify({ appId: APP, tipo: 'Error', mensagem: '', platform: 'web' });
    const resposta = await postarErro(requisicao('/api/public/errors', torto, assinado(torto)));

    expect(resposta.status).toBe(400);
    const corpoDaResposta = (await resposta.json()) as { erro: string; campos: string[] };
    expect(corpoDaResposta.campos).toEqual(
      expect.arrayContaining(['mensagem', 'fatal', 'platform']),
    );
    expect(enviados).toEqual([]);
  });

  it('429 acima do teto do app: um erro em laço não esgota a cota do Sentry', async () => {
    retornoDaRpc = { data: false, error: null };
    const resposta = await postarErro(requisicao('/api/public/errors', corpo, assinado(corpo)));

    expect(resposta.status).toBe(429);
    expect(enviados).toEqual([]);
  });

  it('503 quando o teto não responde, e o motivo fica no log', async () => {
    const erros = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    retornoDaRpc = { data: null, error: { message: 'conexão caiu' } };
    const resposta = await postarErro(requisicao('/api/public/errors', corpo, assinado(corpo)));

    expect(resposta.status).toBe(503);
    await expect(resposta.json()).resolves.toEqual({ erro: 'indisponivel' });
    expect(enviados).toEqual([]);
    const linha = JSON.parse(String(erros.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(linha).toMatchObject({ evento: 'app-erros.teto-indisponivel', nivel: 'erro' });
    erros.mockRestore();
  });
});

describe('POST /api/public/test-device', () => {
  const INSTALACAO = '3f6c1a2e-8d4b-4c7a-9e10-5b2f8a7c6d41';
  const corpo = JSON.stringify({ appId: APP, codigo: 'abcd2345', installId: INSTALACAO });

  it('pareia o celular e passa o código e a instalação para a função', async () => {
    retornoDaRpc = { data: 'pareado', error: null };

    const resposta = await postarPareamento(
      requisicao('/api/public/test-device', corpo, assinado(corpo)),
    );

    expect(resposta.status).toBe(200);
    await expect(resposta.json()).resolves.toEqual({ resultado: 'pareado' });
    expect(resposta.headers.get('Cache-Control')).toBe('no-store');
    expect(argumentosDaRpc).toEqual({
      p_app_id: APP,
      p_codigo: 'abcd2345',
      p_install_id: INSTALACAO,
      p_subscription: undefined,
    });
  });

  it('código vencido chega ao app com 200, para ele explicar ao lojista', async () => {
    retornoDaRpc = { data: 'codigo_invalido', error: null };
    const resposta = await postarPareamento(
      requisicao('/api/public/test-device', corpo, assinado(corpo)),
    );
    expect(resposta.status).toBe(200);
    await expect(resposta.json()).resolves.toEqual({ resultado: 'codigo_invalido' });
  });

  it('sem a assinatura do app, nem chega ao banco', async () => {
    const resposta = await postarPareamento(requisicao('/api/public/test-device', corpo, null));
    expect(resposta.status).toBe(401);
    expect(argumentosDaRpc).toBeNull();
  });

  it('429 no limite de tentativas, e 503 em JSON quando o banco falha', async () => {
    retornoDaRpc = { data: 'limitado', error: null };
    let resposta = await postarPareamento(
      requisicao('/api/public/test-device', corpo, assinado(corpo)),
    );
    expect(resposta.status).toBe(429);

    retornoDaRpc = {
      data: null,
      error: { message: 'relation "test_device_codes" does not exist' },
    };
    resposta = await postarPareamento(
      requisicao('/api/public/test-device', corpo, assinado(corpo)),
    );
    expect(resposta.status).toBe(503);
    const texto = await resposta.text();
    expect(texto).toBe(JSON.stringify({ erro: 'indisponivel' }));
  });
});

describe('POST /api/public/push-opened', () => {
  const ENVIO_DA_AUTOMACAO = '99999999-9999-4999-8999-999999999999';
  const corpo = JSON.stringify({ appId: APP, envio: ENVIO_DA_AUTOMACAO });

  it('conta a abertura do envio, com o app e o envio certos', async () => {
    retornoDaRpc = { data: 'contada', error: null };

    const resposta = await postarAbertura(
      requisicao('/api/public/push-opened', corpo, assinado(corpo)),
    );

    expect(resposta.status).toBe(200);
    await expect(resposta.json()).resolves.toEqual({ contada: true });
    expect(argumentosDaRpc).toEqual({ p_app_id: APP, p_envio: ENVIO_DA_AUTOMACAO });
  });

  it('sem a assinatura do app, nem chega ao banco', async () => {
    const resposta = await postarAbertura(requisicao('/api/public/push-opened', corpo, null));
    expect(resposta.status).toBe(401);
    expect(argumentosDaRpc).toBeNull();
  });

  it('503 em JSON quando o banco falha, sem repetir a mensagem dele', async () => {
    retornoDaRpc = { data: null, error: { message: 'relation "automation_runs" does not exist' } };
    const resposta = await postarAbertura(
      requisicao('/api/public/push-opened', corpo, assinado(corpo)),
    );
    expect(resposta.status).toBe(503);
    expect(await resposta.text()).toBe(JSON.stringify({ erro: 'indisponivel' }));
  });
});

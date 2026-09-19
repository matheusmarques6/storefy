/**
 * O webhook do EAS, exercitado de ponta a ponta.
 *
 * `lib/eas-webhook.test.ts` prova as decisões; aqui se prova a LIGAÇÃO — que o
 * corpo é lido como texto antes de qualquer `JSON.parse`, que a trava de
 * status chega ao `update`, que uma reentrega não reescreve um build já
 * aprovado e que nenhuma exceção escapa como HTML para o Expo.
 *
 * O Supabase é substituído porque a rede para `*.supabase.co` não existe neste
 * ambiente; o que está sendo testado aqui é a rota, não o driver.
 */
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import type * as Submissao from '@/lib/submissao';

const SEGREDO = 'segredo-do-webhook-do-eas';
const EAS_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** O que o `update(...).eq(...).in(...).select(...)` vai devolver. */
let retornoDoUpdate: { data: { id: string }[] | null; error: { message: string } | null } = {
  data: [{ id: 'build-1' }],
  error: null,
};
/** Quantas linhas existem com esse `eas_build_id`, para o desempate do 404. */
let contagem = 1;
/** O que a rota mandou gravar, para conferir a tradução. */
let gravado: Record<string, unknown> | null = null;
/** Os filtros aplicados, para provar que a trava de status está lá. */
let filtros: { coluna: string; valor: unknown }[] = [];
/** Quando ligado, o client estoura — simula o Postgres fora do ar. */
let explodir = false;
/** Os buildIds para os quais o envio foi pedido. */
let enviosPedidos: string[] = [];
/** O que `dispararSubmissao` vai responder. */
let respostaDoEnvio: { ok: true } | { ok: false; motivo: string } = { ok: true };

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave-de-teste',
}));

vi.mock('@/lib/submissao', async (original) => ({
  ...(await original<typeof Submissao>()),
  dispararSubmissao: (buildId: string) => {
    enviosPedidos.push(buildId);
    return Promise.resolve(respostaDoEnvio);
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => {
    if (explodir) throw new Error('banco fora do ar');
    return {
      from: () => ({
        update: (valores: Record<string, unknown>) => {
          gravado = valores;
          const encadeavel = {
            eq: (coluna: string, valor: unknown) => {
              filtros.push({ coluna, valor });
              return encadeavel;
            },
            in: (coluna: string, valor: unknown) => {
              filtros.push({ coluna, valor });
              return encadeavel;
            },
            select: () => Promise.resolve(retornoDoUpdate),
          };
          return encadeavel;
        },
        select: () => ({
          eq: () => Promise.resolve({ count: contagem, error: null }),
        }),
      }),
    };
  },
}));

const { POST } = await import('@/app/api/webhooks/eas/route');

let segredoOriginal: string | undefined;
let avisos: MockInstance<typeof console.warn>;
let erros: MockInstance<typeof console.error>;

beforeEach(() => {
  segredoOriginal = process.env.EAS_WEBHOOK_SECRET;
  process.env.EAS_WEBHOOK_SECRET = SEGREDO;
  retornoDoUpdate = { data: [{ id: 'build-1' }], error: null };
  contagem = 1;
  gravado = null;
  filtros = [];
  explodir = false;
  enviosPedidos = [];
  respostaDoEnvio = { ok: true };
  // O motivo da recusa vai para o log de propósito; o teste não precisa vê-lo.
  avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  erros = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  if (segredoOriginal === undefined) delete process.env.EAS_WEBHOOK_SECRET;
  else process.env.EAS_WEBHOOK_SECRET = segredoOriginal;
  avisos.mockRestore();
  erros.mockRestore();
});

/** Uma requisição igual à que o Expo manda, já assinada. */
function requisicao(corpo: string, assinatura?: string | null): NextRequest {
  const cabecalhos = new Headers({ 'Content-Type': 'application/json' });
  const valor =
    assinatura === undefined
      ? `sha1=${createHmac('sha1', SEGREDO).update(corpo).digest('hex')}`
      : assinatura;
  if (valor !== null) cabecalhos.set('expo-signature', valor);

  return new NextRequest('https://app.storefy.com.br/api/webhooks/eas', {
    method: 'POST',
    headers: cabecalhos,
    body: corpo,
  });
}

const payload = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    id: EAS_ID,
    platform: 'ios',
    status: 'finished',
    buildDetailsPageUrl: 'https://expo.dev/accounts/convertfy/builds/e1',
    artifacts: { buildUrl: 'https://exemplo/app.aab', logsUrl: 'https://exemplo/logs.txt' },
    metadata: { appVersion: '1.3.0', appBuildVersion: '11' },
    error: null,
    ...extra,
  });

describe('POST /api/webhooks/eas', () => {
  it('build terminado fecha a linha com versão, número e link', async () => {
    const resposta = await POST(requisicao(payload()));

    expect(resposta.status).toBe(200);
    expect(gravado).toMatchObject({
      status: 'finished',
      version: '1.3.0',
      build_number: 11,
      logs_url: 'https://expo.dev/accounts/convertfy/builds/e1',
    });
    expect(typeof gravado?.finished_at).toBe('string');
  });

  /*
   * O link do binário é o que salva o lojista quando o envio automático não é
   * possível — no Google, o PRIMEIRO envio de um app é sempre manual. Sem
   * guardá-lo, o build "pronto" não serviria para nada.
   */
  it('guarda o link do binário gerado', async () => {
    await POST(requisicao(payload()));
    expect(gravado?.artifact_url).toBe('https://exemplo/app.aab');
  });

  /*
   * Binário pronto começa o envio (passo 5 do plano). É aqui e não no workflow
   * de geração porque aquele sai com `--no-wait` e termina minutos antes de o
   * binário existir.
   */
  it('build terminado pede o envio para a loja', async () => {
    await POST(requisicao(payload()));
    expect(enviosPedidos).toEqual(['build-1']);
  });

  it('build que falhou ou foi cancelado não pede envio nenhum', async () => {
    for (const status of ['errored', 'canceled']) {
      enviosPedidos = [];
      await POST(requisicao(payload({ status })));
      expect(enviosPedidos).toEqual([]);
    }
  });

  /*
   * Um binário pronto que ninguém enviou é um problema DO LOJISTA: deixá-lo em
   * "indo para a loja" o faria esperar por algo que não vai acontecer. Vira
   * erro com a explicação e o passo manual — o link do arquivo já está lá.
   */
  it('envio que não pôde ser disparado vira erro com passo manual', async () => {
    respostaDoEnvio = { ok: false, motivo: 'não deu' };

    await POST(requisicao(payload()));

    expect(gravado).toMatchObject({
      status: 'errored',
      error: 'não deu',
      manual_action: 'envio_manual',
    });
  });

  /*
   * A trava é o que impede uma reentrega tardia do EAS de reescrever como
   * "gerado" um app que a Apple já aprovou. Ela precisa chegar ao `update`.
   */
  it('só mexe em build na fila ou gerando, e só pelo id do EAS', async () => {
    await POST(requisicao(payload()));

    expect(filtros).toContainEqual({ coluna: 'eas_build_id', valor: EAS_ID });
    expect(filtros).toContainEqual({ coluna: 'status', valor: ['queued', 'building'] });
  });

  it('build que falhou grava a mensagem traduzida', async () => {
    await POST(
      requisicao(
        payload({ status: 'errored', error: { errorCode: 'EAS_BUILD_CREDENTIALS_ERROR' } }),
      ),
    );

    expect(gravado?.status).toBe('errored');
    expect(String(gravado?.error)).toContain('Reconecte');
  });

  it('recusa assinatura errada sem tocar no banco', async () => {
    const resposta = await POST(requisicao(payload(), 'sha1=00'));

    expect(resposta.status).toBe(401);
    expect(gravado).toBeNull();
  });

  it('recusa sem assinatura nenhuma', async () => {
    expect((await POST(requisicao(payload(), null))).status).toBe(401);
    expect(gravado).toBeNull();
  });

  /*
   * Sem segredo configurado a rota responde 503, e não 200: assim o EAS
   * reentrega quando o ambiente voltar, em vez de dar o webhook por entregue.
   */
  it('sem EAS_WEBHOOK_SECRET responde 503 e não grava nada', async () => {
    delete process.env.EAS_WEBHOOK_SECRET;

    const resposta = await POST(requisicao(payload(), 'sha1=qualquer'));
    expect(resposta.status).toBe(503);
    expect(gravado).toBeNull();
  });

  /*
   * O corpo é conferido como TEXTO. Se a rota parseasse antes de conferir, um
   * payload reserializado passaria — e a assinatura não valeria nada.
   */
  it('corpo diferente do assinado é recusado', async () => {
    const corpo = payload();
    const outro = JSON.stringify(JSON.parse(corpo), null, 2);
    const assinatura = `sha1=${createHmac('sha1', SEGREDO).update(corpo).digest('hex')}`;

    const resposta = await POST(requisicao(outro, assinatura));
    expect(resposta.status).toBe(401);
  });

  it('JSON quebrado vira 400, e não uma exceção', async () => {
    const resposta = await POST(requisicao('{isto não é json'));
    expect(resposta.status).toBe(400);
    expect(gravado).toBeNull();
  });

  it('payload sem id vira 400', async () => {
    const resposta = await POST(requisicao(JSON.stringify({ status: 'finished' })));
    expect(resposta.status).toBe(400);
  });

  /*
   * Status que não conhecemos: 200 sem escrita. 200 porque a mensagem chegou
   * inteira e o EAS não tem o que reentregar; sem escrita porque traduzir um
   * status novo deles num status nosso seria chutar.
   */
  it('status desconhecido é aceito e ignorado', async () => {
    const resposta = await POST(requisicao(payload({ status: 'in-queue' })));

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ ok: true, ignorado: 'in-queue' });
    expect(gravado).toBeNull();
  });

  /*
   * Zero linhas com o build existindo = reentrega de um webhook já aplicado.
   * 200 para o EAS parar de tentar.
   */
  it('reentrega de build já concluído responde 200', async () => {
    retornoDoUpdate = { data: [], error: null };
    contagem = 1;

    const resposta = await POST(requisicao(payload()));
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ ignorado: 'ja_concluido' });
  });

  /*
   * Zero linhas e nenhum build com esse id = o webhook chegou antes de o
   * workflow gravar o `eas_build_id`. 404 para o EAS reentregar.
   */
  it('build desconhecido responde 404 para o EAS tentar de novo', async () => {
    retornoDoUpdate = { data: [], error: null };
    contagem = 0;

    const resposta = await POST(requisicao(payload()));
    expect(resposta.status).toBe(404);
  });

  it('erro do banco vira 503 sem vazar a mensagem', async () => {
    retornoDoUpdate = { data: null, error: { message: 'coluna secreta: abc123' } };

    const resposta = await POST(requisicao(payload()));
    expect(resposta.status).toBe(503);
    expect(JSON.stringify(await resposta.json())).not.toContain('abc123');
  });

  it('exceção do client vira 503, e não HTML de erro do Next', async () => {
    explodir = true;

    const resposta = await POST(requisicao(payload()));
    expect(resposta.status).toBe(503);
    expect(resposta.headers.get('content-type')).toContain('application/json');
  });

  it('a resposta nunca fica em cache', async () => {
    const resposta = await POST(requisicao(payload()));
    expect(resposta.headers.get('cache-control')).toBe('no-store');
  });
});

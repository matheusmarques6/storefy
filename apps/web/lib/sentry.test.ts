import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  lerDsn,
  montarEnvelope,
  quadrosDaPilha,
  relatarErro,
  sentryConfigurado,
} from '@/lib/sentry';

const DSN = 'https://abc123@o42.ingest.sentry.io/4507';
const ORIGINAL = process.env.SENTRY_DSN;

beforeEach(() => {
  process.env.SENTRY_DSN = DSN;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = ORIGINAL;
});

describe('lerDsn', () => {
  it('separa chave, origem e projeto', () => {
    expect(lerDsn(DSN)).toEqual({
      chavePublica: 'abc123',
      origem: 'https://o42.ingest.sentry.io',
      projeto: '4507',
      bruto: DSN,
    });
  });

  it('aceita Sentry próprio com prefixo de caminho', () => {
    expect(lerDsn('https://k@erros.minhaempresa.com/sentry/7')?.origem).toBe(
      'https://erros.minhaempresa.com/sentry',
    );
  });

  it('o que não é DSN vira "não configurado", e não erro', () => {
    for (const ruim of [
      undefined,
      '',
      '   ',
      'não é url',
      'https://sentry.io/1',
      'https://k@sentry.io/abc',
      'ftp://k@x/1',
    ]) {
      expect(lerDsn(ruim), String(ruim)).toBeNull();
    }
  });

  it('sentryConfigurado segue o ambiente', () => {
    expect(sentryConfigurado()).toBe(true);
    delete process.env.SENTRY_DSN;
    expect(sentryConfigurado()).toBe(false);
  });
});

describe('quadrosDaPilha', () => {
  it('lê a pilha do V8, do mais antigo para o mais novo', () => {
    const pilha = [
      'Error: quebrou',
      '    at salvar (/var/task/.next/server/app/page.js:10:5)',
      '    at async Promise.all (index 0)',
      '    at /var/task/node_modules/next/dist/server.js:1:2',
    ].join('\n');
    expect(quadrosDaPilha(pilha)).toEqual([
      {
        filename: '/var/task/node_modules/next/dist/server.js',
        lineno: 1,
        colno: 2,
        in_app: false,
      },
      {
        function: 'salvar',
        filename: '/var/task/.next/server/app/page.js',
        lineno: 10,
        colno: 5,
        in_app: true,
      },
    ]);
  });

  it('e a do Safari (JavaScriptCore), que o app e o navegador mandam', () => {
    expect(quadrosDaPilha('Error\nabrir@http://x/app.js:3:4')).toEqual([
      { function: 'abrir', filename: 'http://x/app.js', lineno: 3, colno: 4, in_app: true },
    ]);
  });

  it('e a do Hermes no build de produção do app, sem o "address at"', () => {
    const pilha = [
      'TypeError: Cannot read property of undefined',
      '    at salvar (address at index.android.bundle:1:2345)',
      '    at anonymous (address at index.android.bundle:1:99)',
    ].join('\n');
    expect(quadrosDaPilha(pilha)).toEqual([
      {
        function: 'anonymous',
        filename: 'index.android.bundle',
        lineno: 1,
        colno: 99,
        in_app: true,
      },
      {
        function: 'salvar',
        filename: 'index.android.bundle',
        lineno: 1,
        colno: 2345,
        in_app: true,
      },
    ]);
  });
});

describe('montarEnvelope', () => {
  it('três linhas: envelope, item e o evento com marcas', () => {
    const dsn = lerDsn(DSN);
    if (dsn === null) throw new Error('dsn');
    const erro = Object.assign(new Error('quebrou'), { digest: 'd1' });
    const [cabecalho, item, evento] = montarEnvelope(
      dsn,
      {
        erro,
        origem: 'app',
        marcas: { rota: '/publicacao' },
        extras: { token: 'shpat_x', loja: 'l1' },
      },
      { release: 'abc', environment: 'preview' },
      new Date('2026-09-29T12:00:00Z'),
    )
      .split('\n')
      .map((linha) => JSON.parse(linha) as Record<string, unknown>);

    expect(cabecalho).toMatchObject({ dsn: DSN, sent_at: '2026-09-29T12:00:00.000Z' });
    expect(item).toEqual({ type: 'event' });
    expect(evento).toMatchObject({
      level: 'error',
      release: 'abc',
      environment: 'preview',
      tags: { origem: 'app', digest: 'd1', rota: '/publicacao' },
      extra: { token: '[oculto]', loja: 'l1' },
      exception: { values: [{ type: 'Error', value: 'quebrou' }] },
    });
    expect(String(evento?.event_id)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('relatarErro', () => {
  it('manda para a API de envelopes com a chave no cabeçalho', async () => {
    const falso = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        await Promise.resolve(new Response('{}', { status: 200 })),
    );
    expect(await relatarErro({ erro: new Error('x'), origem: 'job' }, falso)).toBe(true);
    const [url, init] = falso.mock.calls[0] ?? [];
    expect(url).toBe('https://o42.ingest.sentry.io/api/4507/envelope/');
    expect(new Headers(init?.headers).get('X-Sentry-Auth')).toContain('sentry_key=abc123');
  });

  it('sem DSN, nem tenta', async () => {
    delete process.env.SENTRY_DSN;
    const falso = vi.fn();
    expect(await relatarErro({ erro: new Error('x'), origem: 'job' }, falso)).toBe(false);
    expect(falso).not.toHaveBeenCalled();
  });

  it('Sentry fora do ar não vira outro erro, mas fica no log', async () => {
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const falso = vi.fn(async () => await Promise.reject(new Error('sem rede')));
    expect(await relatarErro({ erro: new Error('x'), origem: 'job' }, falso)).toBe(false);
    const linha = JSON.parse(String(avisos.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(linha).toMatchObject({ evento: 'sentry.inalcancavel', nivel: 'aviso' });
    avisos.mockRestore();
  });

  it('cota estourada ou DSN errado: devolve falso e deixa o status no log', async () => {
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const falso = vi.fn(async () => await Promise.resolve(new Response('', { status: 429 })));
    expect(await relatarErro({ erro: new Error('x'), origem: 'job' }, falso)).toBe(false);
    const linha = JSON.parse(String(avisos.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(linha).toMatchObject({ evento: 'sentry.recusou', status: 429 });
    avisos.mockRestore();
  });
});

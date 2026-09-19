import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TIPO_DO_EVENTO,
  dispararBuild,
  faltaConfiguracaoDoDisparo,
  lerRespostaDoDisparo,
} from '@/lib/disparo-de-build';

const PEDIDO = {
  buildId: '11111111-1111-4111-8111-111111111111',
  storeId: '22222222-2222-4222-8222-222222222222',
  appId: '33333333-3333-4333-8333-333333333333',
  platform: 'ios' as const,
  configVersion: 4,
};

let tokenOriginal: string | undefined;
let repoOriginal: string | undefined;

beforeEach(() => {
  tokenOriginal = process.env.GITHUB_DISPATCH_TOKEN;
  repoOriginal = process.env.GITHUB_REPO;
  process.env.GITHUB_DISPATCH_TOKEN = 'ghp_token';
  process.env.GITHUB_REPO = 'convertfy/storefy';
});

afterEach(() => {
  if (tokenOriginal === undefined) delete process.env.GITHUB_DISPATCH_TOKEN;
  else process.env.GITHUB_DISPATCH_TOKEN = tokenOriginal;
  if (repoOriginal === undefined) delete process.env.GITHUB_REPO;
  else process.env.GITHUB_REPO = repoOriginal;
});

describe('faltaConfiguracaoDoDisparo', () => {
  it('com token e repositório, não falta nada', () => {
    expect(faltaConfiguracaoDoDisparo('t', 'dono/repo')).toBeNull();
  });

  it('sem token ou com repositório torto, falta', () => {
    for (const [token, repo] of [
      [undefined, 'dono/repo'],
      ['', 'dono/repo'],
      ['t', undefined],
      ['t', ''],
      ['t', 'sem-barra'],
      ['t', 'dono/repo/extra'],
      ['t', 'dono / repo'],
    ] as [string | undefined, string | undefined][]) {
      expect(faltaConfiguracaoDoDisparo(token, repo)).not.toBeNull();
    }
  });

  it('a mensagem não expõe nome de variável de ambiente ao lojista', () => {
    const motivo = faltaConfiguracaoDoDisparo(undefined, undefined);
    expect(motivo).not.toMatch(/GITHUB|TOKEN|env/i);
  });
});

describe('lerRespostaDoDisparo', () => {
  it('204 é o sucesso do GitHub', () => {
    expect(lerRespostaDoDisparo(204)).toEqual({ ok: true });
  });

  it('200 não é sucesso: o dispatch responde 204', () => {
    expect(lerRespostaDoDisparo(200).ok).toBe(false);
  });

  /*
   * 404 no dispatch quase sempre é token sem permissão, e não repositório
   * inexistente: o GitHub esconde repositório privado de quem não pode vê-lo.
   * Mandar o lojista "conferir o repositório" seria mandá-lo procurar o que
   * não é problema dele.
   */
  it('401, 403 e 404 dão a mesma mensagem, que é nossa e não dele', () => {
    const mensagens = [401, 403, 404].map((status) => {
      const r = lerRespostaDoDisparo(status);
      return r.ok ? '' : r.motivo;
    });
    expect(new Set(mensagens).size).toBe(1);
    expect(mensagens[0]).toContain('Storefy');
  });

  it('outros erros mandam tentar de novo', () => {
    const r = lerRespostaDoDisparo(500);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('Tente de novo');
  });
});

describe('dispararBuild', () => {
  it('chama o dispatch do repositório com o evento certo', async () => {
    const chamadas: { url: string; corpo: string; cabecalhos: Record<string, string> }[] = [];
    const buscador = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const enviado = init?.body;
      chamadas.push({
        url: url instanceof Request ? url.url : url.toString(),
        corpo: typeof enviado === 'string' ? enviado : '',
        cabecalhos: (init?.headers ?? {}) as Record<string, string>,
      });
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch;

    const r = await dispararBuild(PEDIDO, buscador);

    expect(r).toEqual({ ok: true });
    expect(chamadas[0]?.url).toBe('https://api.github.com/repos/convertfy/storefy/dispatches');
    expect(chamadas[0]?.cabecalhos.Authorization).toBe('Bearer ghp_token');

    const corpo = JSON.parse(chamadas[0]?.corpo ?? '{}') as Record<string, unknown>;
    expect(corpo.event_type).toBe(TIPO_DO_EVENTO);
    expect(corpo.client_payload).toEqual({
      buildId: PEDIDO.buildId,
      storeId: PEDIDO.storeId,
      appId: PEDIDO.appId,
      platform: 'ios',
      configVersion: 4,
    });
  });

  /*
   * O payload de um dispatch fica visível para quem tem acesso de leitura às
   * execuções do repositório. Só identificadores passam por aqui; o workflow
   * busca o resto por uma rota autenticada.
   */
  it('o payload leva só identificadores, nunca credencial', async () => {
    const corpos: string[] = [];
    const buscador = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      corpos.push(typeof init?.body === 'string' ? init.body : '');
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch;

    await dispararBuild(PEDIDO, buscador);

    const texto = corpos[0] ?? '';
    for (const proibido of ['ghp_token', 'PRIVATE KEY', 'service_account', '_enc', 'secret']) {
      expect(texto).not.toContain(proibido);
    }
  });

  it('sem configuração, nem chega a chamar o GitHub', async () => {
    delete process.env.GITHUB_DISPATCH_TOKEN;
    const buscador = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    ) as unknown as typeof fetch;

    const r = await dispararBuild(PEDIDO, buscador);
    expect(r.ok).toBe(false);
    expect(vi.mocked(buscador)).not.toHaveBeenCalled();
  });

  it('rede caindo vira mensagem, não exceção', async () => {
    const quebrado = (() => Promise.reject(new Error('sem rede'))) as unknown as typeof fetch;
    const r = await dispararBuild(PEDIDO, quebrado);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('Tente de novo');
  });

  it('nunca devolve o token na mensagem de erro', async () => {
    const recusado = (() =>
      Promise.resolve(new Response('{}', { status: 403 }))) as unknown as typeof fetch;

    const r = await dispararBuild(PEDIDO, recusado);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).not.toContain('ghp_token');
  });
});

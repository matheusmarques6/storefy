/**
 * O cliente dos dois endpoints que o app escreve.
 *
 * O teste mais importante daqui é o de compatibilidade: a assinatura que o app
 * monta tem que ser exatamente a que o servidor confere. São duas
 * implementações escritas separadamente, em runtimes diferentes, e se elas
 * divergirem em um caractere o sintoma é "o push não funciona", sem nenhuma
 * pista. Por isso o valor esperado aqui é calculado com o `node:crypto`,
 * seguindo a mesma fórmula de `apps/web/lib/assinatura.ts`.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  CABECALHO_DA_ASSINATURA,
  assinar,
  credenciaisDe,
  enviarEventoDeCarrinho,
  registrarAparelho,
  type Credenciais,
} from './api.ts';

const CREDENCIAIS: Credenciais = {
  apiBase: 'https://storefy.convertfy.me',
  appId: '11111111-1111-4111-8111-111111111111',
  segredo: 'segredo-deste-build',
};
const AGORA = 1_800_000_000_000;

/** A conta do servidor, escrita aqui do zero, como conferência cruzada. */
function comoOServidorCalcula(segredo: string, quandoMs: number, corpo: string): string {
  const t = Math.floor(quandoMs / 1000);
  const v1 = createHmac('sha256', segredo)
    .update(`${String(t)}.${corpo}`)
    .digest('hex');
  return `t=${String(t)},v1=${v1}`;
}

/** Um `fetch` de mentira que guarda o que recebeu. */
interface ChamadaFeita {
  url: string;
  metodo: string;
  corpo: string;
  cabecalhos: Record<string, string>;
}

function fingirFetch(resposta: { status: number; corpo?: unknown } = { status: 200, corpo: {} }): {
  buscador: typeof fetch;
  chamadas: ChamadaFeita[];
} {
  const chamadas: ChamadaFeita[] = [];
  const buscador = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const enviado = init?.body;
    chamadas.push({
      url: url instanceof Request ? url.url : url.toString(),
      metodo: init?.method ?? 'GET',
      // O corpo destas requisições é sempre texto; guardá-lo já como texto é o
      // que deixa a asserção comparar exatamente o que foi assinado.
      corpo: typeof enviado === 'string' ? enviado : '',
      cabecalhos: (init?.headers ?? {}) as Record<string, string>,
    });
    return Promise.resolve(
      new Response(JSON.stringify(resposta.corpo ?? {}), {
        status: resposta.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return { buscador, chamadas };
}

describe('assinar', () => {
  it('produz exatamente a assinatura que o servidor confere', () => {
    for (const corpo of [
      '{}',
      '{"appId":"x","itemCount":3}',
      '{"loja":"Café à brasileira 🛒"}',
      'a'.repeat(4000),
    ]) {
      expect(assinar(CREDENCIAIS.segredo, AGORA, corpo)).toBe(
        comoOServidorCalcula(CREDENCIAIS.segredo, AGORA, corpo),
      );
    }
  });

  it('usa segundos, não milissegundos, como o servidor', () => {
    expect(assinar('s', 1_800_000_000_999, '{}')).toContain('t=1800000000,');
  });

  it('muda quando o corpo muda, mesmo por um caractere', () => {
    const a = assinar('s', AGORA, '{"itemCount":3}');
    const b = assinar('s', AGORA, '{"itemCount":4}');
    expect(a).not.toBe(b);
  });

  it('muda quando o segredo muda: é isso que separa uma loja da outra', () => {
    expect(assinar('loja-a', AGORA, '{}')).not.toBe(assinar('loja-b', AGORA, '{}'));
  });
});

describe('registrarAparelho', () => {
  it('manda o corpo assinado para o endpoint certo', async () => {
    const { buscador, chamadas } = fingirFetch({
      status: 200,
      corpo: { deviceId: 'd1', novo: true, boasVindas: false },
    });

    const r = await registrarAparelho(
      CREDENCIAIS,
      { subscriptionId: 'sub-1', platform: 'ios', appVersion: '1.0.0' },
      { buscador, agoraMs: AGORA },
    );

    expect(r).toEqual({ ok: true, dados: { deviceId: 'd1', novo: true, boasVindas: false } });
    expect(chamadas).toHaveLength(1);

    const chamada = chamadas[0];
    expect(chamada?.url).toBe('https://storefy.convertfy.me/api/public/devices');
    expect(chamada?.metodo).toBe('POST');

    const corpo = chamada?.corpo ?? '';
    expect(JSON.parse(corpo)).toEqual({
      appId: CREDENCIAIS.appId,
      subscriptionId: 'sub-1',
      platform: 'ios',
      appVersion: '1.0.0',
    });

    // E a assinatura é sobre ESTE texto, byte a byte.
    expect(chamada?.cabecalhos[CABECALHO_DA_ASSINATURA]).toBe(
      comoOServidorCalcula(CREDENCIAIS.segredo, AGORA, corpo),
    );
  });

  it('não inventa campos que o app não sabe', async () => {
    const { buscador, chamadas } = fingirFetch();
    await registrarAparelho(
      CREDENCIAIS,
      { subscriptionId: 'sub-1', platform: 'android' },
      { buscador, agoraMs: AGORA },
    );

    const corpo = JSON.parse(chamadas[0]?.corpo ?? '') as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(['appId', 'platform', 'subscriptionId']);
  });

  it('traduz 429 em limite, para quem chama saber que deve esperar', async () => {
    const { buscador } = fingirFetch({ status: 429 });
    const r = await registrarAparelho(
      CREDENCIAIS,
      { subscriptionId: 'sub-1', platform: 'ios' },
      { buscador },
    );
    expect(r).toEqual({ ok: false, motivo: 'limite', status: 429 });
  });

  it('traduz 401 em recusado: tentar de novo daria no mesmo', async () => {
    const { buscador } = fingirFetch({ status: 401 });
    const r = await registrarAparelho(
      CREDENCIAIS,
      { subscriptionId: 'sub-1', platform: 'ios' },
      { buscador },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('recusado');
  });

  it('traduz 503 em servidor, que vale a pena tentar de novo', async () => {
    const { buscador } = fingirFetch({ status: 503 });
    const r = await registrarAparelho(
      CREDENCIAIS,
      { subscriptionId: 'sub-1', platform: 'ios' },
      { buscador },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('servidor');
  });

  /*
   * O ponto inegociável: o cliente veio comprar, não receber push. Nenhuma
   * falha aqui pode chegar como exceção à tela que abre a loja.
   */
  it('não lança quando a rede cai', async () => {
    const quebrado = (() => Promise.reject(new Error('sem rede'))) as unknown as typeof fetch;
    const r = await registrarAparelho(
      CREDENCIAIS,
      { subscriptionId: 'sub-1', platform: 'ios' },
      { buscador: quebrado },
    );
    expect(r).toEqual({ ok: false, motivo: 'rede' });
  });

  it('não lança quando a resposta não é JSON', async () => {
    const html = (() =>
      Promise.resolve(
        new Response('<html>erro</html>', { status: 200 }),
      )) as unknown as typeof fetch;
    const r = await registrarAparelho(
      CREDENCIAIS,
      { subscriptionId: 'sub-1', platform: 'ios' },
      { buscador: html },
    );
    expect(r).toEqual({ ok: false, motivo: 'rede' });
  });

  it('desiste depois do tempo limite em vez de travar o app', async () => {
    const eterno = ((_url: string, init?: RequestInit) =>
      new Promise((_resolver, rejeitar) => {
        init?.signal?.addEventListener('abort', () => {
          rejeitar(new Error('abortado'));
        });
      })) as unknown as typeof fetch;

    const r = await registrarAparelho(
      CREDENCIAIS,
      { subscriptionId: 'sub-1', platform: 'ios' },
      { buscador: eterno, timeoutMs: 20 },
    );
    expect(r).toEqual({ ok: false, motivo: 'rede' });
  });
});

describe('enviarEventoDeCarrinho', () => {
  it('manda o evento para o endpoint de eventos', async () => {
    const { buscador, chamadas } = fingirFetch({
      status: 200,
      corpo: { eventId: 'e1', agendou: true, cancelou: 0 },
    });

    const r = await enviarEventoDeCarrinho(
      CREDENCIAIS,
      {
        subscriptionId: 'sub-1',
        event: 'add',
        itemCount: 2,
        cartToken: 'tok',
        valueCents: 9900,
        currency: 'BRL',
      },
      { buscador, agoraMs: AGORA },
    );

    expect(r).toEqual({ ok: true, dados: { eventId: 'e1', agendou: true, cancelou: 0 } });
    expect(chamadas[0]?.url).toBe('https://storefy.convertfy.me/api/public/events');
    expect(JSON.parse(chamadas[0]?.corpo ?? '')).toEqual({
      appId: CREDENCIAIS.appId,
      subscriptionId: 'sub-1',
      event: 'add',
      itemCount: 2,
      cartToken: 'tok',
      valueCents: 9900,
      currency: 'BRL',
    });
  });

  it('manda carrinho zerado, que é o sinal de cancelar o push', async () => {
    const { buscador, chamadas } = fingirFetch();
    await enviarEventoDeCarrinho(
      CREDENCIAIS,
      { subscriptionId: 'sub-1', event: 'update', itemCount: 0 },
      { buscador, agoraMs: AGORA },
    );
    const corpo = JSON.parse(chamadas[0]?.corpo ?? '') as { itemCount: number };
    expect(corpo.itemCount).toBe(0);
  });
});

describe('credenciaisDe', () => {
  const base = {
    apiBase: 'https://storefy.convertfy.me',
    appId: 'app-1',
    deviceSecret: 'segredo',
  };

  it('monta quando há tudo', () => {
    expect(credenciaisDe(base)).toEqual({
      apiBase: 'https://storefy.convertfy.me',
      appId: 'app-1',
      segredo: 'segredo',
    });
  });

  it('tira a barra do fim, senão a URL sai com barra dupla', () => {
    expect(credenciaisDe({ ...base, apiBase: 'https://x.com.br///' })?.apiBase).toBe(
      'https://x.com.br',
    );
  });

  /*
   * `expo start` sem variáveis cai aqui, e é o estado normal de quem está
   * desenvolvendo. O app tem que abrir igual — só não registra nem manda
   * evento.
   */
  it('devolve null quando falta qualquer parte', () => {
    expect(credenciaisDe({ ...base, appId: null })).toBeNull();
    expect(credenciaisDe({ ...base, deviceSecret: null })).toBeNull();
    expect(credenciaisDe({ ...base, apiBase: '' })).toBeNull();
    expect(credenciaisDe({ ...base, apiBase: '///' })).toBeNull();
  });
});

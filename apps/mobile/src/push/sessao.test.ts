/**
 * A orquestração do push, com o SDK e a rede fingidos.
 *
 * O que se prova aqui é ORDEM e AUSÊNCIA DE ESTRAGO: que o aparelho não é
 * registrado sem ID de inscrição, que o toque numa notificação de fora não
 * leva a lugar nenhum, que a compra cancela o carrinho abandonado e que nada
 * disso lança — porque o cliente veio comprar, não receber push.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  carrinhoMudou,
  checkoutIniciado,
  identificarCliente,
  iniciarPush,
  ouvirToques,
  pedidoConcluido,
  registrarQuandoAssinar,
  type DependenciasDaSessao,
} from './sessao.ts';
import type { Notificador } from './onesignal.ts';
import type { NotificacaoRecebida } from './deep-link.ts';
import type { DestinoDoPush } from './deep-link.ts';

const CREDENCIAIS = {
  apiBase: 'https://storefy.convertfy.me',
  appId: '11111111-1111-4111-8111-111111111111',
  segredo: 'segredo',
};

/** Um SDK de mentira que guarda tudo que recebeu. */
function fingirNotificador(inscricao: string | null = 'sub-1'): {
  notificador: Notificador;
  registro: {
    iniciadoCom: string[];
    tags: Record<string, string>[];
    identificados: string[];
    esqueceu: number;
    aoTocar: ((n: NotificacaoRecebida) => void)[];
    aoMudar: ((id: string | null) => void)[];
  };
} {
  const registro = {
    iniciadoCom: [] as string[],
    tags: [] as Record<string, string>[],
    identificados: [] as string[],
    esqueceu: 0,
    aoTocar: [] as ((n: NotificacaoRecebida) => void)[],
    aoMudar: [] as ((id: string | null) => void)[],
  };

  const notificador: Notificador = {
    iniciar: (appId) => registro.iniciadoCom.push(appId),
    idDaInscricao: () => Promise.resolve(inscricao),
    temPermissao: () => Promise.resolve(true),
    podePedir: () => Promise.resolve(true),
    pedirPermissao: () => Promise.resolve(true),
    identificar: (id) => registro.identificados.push(id),
    esquecerIdentificacao: () => {
      registro.esqueceu += 1;
    },
    marcar: (tags) => registro.tags.push(tags),
    aoTocar: (ouvinte) => registro.aoTocar.push(ouvinte),
    aoMudarInscricao: (ouvinte) => registro.aoMudar.push(ouvinte),
  };

  return { notificador, registro };
}

/** Guarda o que foi enviado à API e devolve sucesso. */
function fingirRede(status = 200): {
  buscador: typeof fetch;
  enviados: { url: string; corpo: Record<string, unknown> }[];
} {
  const enviados: { url: string; corpo: Record<string, unknown> }[] = [];
  const buscador = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const texto = typeof init?.body === 'string' ? init.body : '{}';
    enviados.push({
      url: url instanceof Request ? url.url : url.toString(),
      corpo: JSON.parse(texto) as Record<string, unknown>,
    });
    return Promise.resolve(
      new Response(JSON.stringify({ deviceId: 'd1', novo: true, boasVindas: false }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return { buscador, enviados };
}

function dependencias(
  notificador: Notificador,
  extra: Partial<DependenciasDaSessao> = {},
): DependenciasDaSessao {
  return {
    notificador,
    credenciais: CREDENCIAIS,
    plataforma: 'ios',
    appVersion: '1.0.0',
    oneSignalAppId: 'os-app-1',
    ...extra,
  };
}

describe('iniciarPush', () => {
  it('inicia o SDK e registra o aparelho', async () => {
    const { notificador, registro } = fingirNotificador('sub-1');
    const { buscador, enviados } = fingirRede();
    vi.stubGlobal('fetch', buscador);

    const r = await iniciarPush(dependencias(notificador));

    expect(registro.iniciadoCom).toEqual(['os-app-1']);
    expect(r).toEqual({ iniciou: true, inscricao: 'sub-1', registrou: true, motivo: undefined });
    expect(enviados[0]?.url).toContain('/api/public/devices');
    expect(enviados[0]?.corpo).toMatchObject({ subscriptionId: 'sub-1', platform: 'ios' });

    vi.unstubAllGlobals();
  });

  it('marca a versão do app já na abertura', async () => {
    const { notificador, registro } = fingirNotificador();
    const { buscador } = fingirRede();
    vi.stubGlobal('fetch', buscador);

    await iniciarPush(dependencias(notificador));
    expect(registro.tags).toContainEqual({ app_version: '1.0.0' });

    vi.unstubAllGlobals();
  });

  /*
   * O SDK conversa com o servidor do OneSignal antes de existir um ID. Mandar
   * o registro assim mesmo criaria uma linha em `devices` que não corresponde
   * a aparelho nenhum — e o push dela nunca chegaria a ninguém.
   */
  it('NÃO registra enquanto não há ID de inscrição', async () => {
    const { notificador } = fingirNotificador(null);
    const { buscador, enviados } = fingirRede();
    vi.stubGlobal('fetch', buscador);

    const r = await iniciarPush(dependencias(notificador));

    expect(r.iniciou).toBe(true);
    expect(r.registrou).toBe(false);
    expect(enviados).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it('não faz nada sem app do OneSignal no build', async () => {
    const { notificador, registro } = fingirNotificador();
    const r = await iniciarPush(dependencias(notificador, { oneSignalAppId: null }));

    expect(r.iniciou).toBe(false);
    expect(registro.iniciadoCom).toEqual([]);
  });

  it('inicia o SDK mesmo sem credencial da API, só não registra', async () => {
    const { notificador, registro } = fingirNotificador();
    const r = await iniciarPush(dependencias(notificador, { credenciais: null }));

    // O push ainda chega: quem envia é o OneSignal. O que se perde é a nossa
    // contagem de instalações e a automação.
    expect(registro.iniciadoCom).toEqual(['os-app-1']);
    expect(r).toMatchObject({ iniciou: true, inscricao: 'sub-1', registrou: false });
  });

  it('não lança quando o SDK explode', async () => {
    const { notificador } = fingirNotificador();
    const quebrado: Notificador = {
      ...notificador,
      iniciar: () => {
        throw new Error('módulo nativo ausente');
      },
    };

    await expect(iniciarPush(dependencias(quebrado))).resolves.toMatchObject({ iniciou: false });
  });

  it('não lança quando a leitura da inscrição falha', async () => {
    const { notificador } = fingirNotificador();
    const quebrado: Notificador = {
      ...notificador,
      idDaInscricao: () => Promise.reject(new Error('sem rede')),
    };

    await expect(iniciarPush(dependencias(quebrado))).resolves.toMatchObject({
      iniciou: true,
      registrou: false,
    });
  });

  it('não lança quando marcar tag falha', async () => {
    const { notificador } = fingirNotificador();
    const { buscador } = fingirRede();
    vi.stubGlobal('fetch', buscador);

    const quebrado: Notificador = {
      ...notificador,
      marcar: () => {
        throw new Error('sem usuário ainda');
      },
    };

    await expect(iniciarPush(dependencias(quebrado))).resolves.toMatchObject({ registrou: true });
    vi.unstubAllGlobals();
  });
});

describe('registrarQuandoAssinar', () => {
  /*
   * Quem acaba de aceitar a notificação ganha um ID que não existia na
   * abertura. Sem este caminho, esse cliente só seria registrado na PRÓXIMA
   * vez que abrisse o app — e as campanhas de hoje não o alcançariam.
   */
  it('registra quando a inscrição aparece depois', async () => {
    const { notificador, registro } = fingirNotificador(null);
    const { buscador, enviados } = fingirRede();
    vi.stubGlobal('fetch', buscador);

    const aoRegistrar = vi.fn();
    registrarQuandoAssinar(dependencias(notificador), aoRegistrar);

    expect(registro.aoMudar).toHaveLength(1);
    registro.aoMudar[0]?.('sub-nova');
    await vi.waitFor(() => {
      expect(aoRegistrar).toHaveBeenCalled();
    });

    expect(enviados[0]?.corpo).toMatchObject({ subscriptionId: 'sub-nova' });
    vi.unstubAllGlobals();
  });

  it('ignora quando a inscrição some (o cliente desativou)', async () => {
    const { notificador, registro } = fingirNotificador();
    const { buscador, enviados } = fingirRede();
    vi.stubGlobal('fetch', buscador);

    registrarQuandoAssinar(dependencias(notificador));
    registro.aoMudar[0]?.(null);
    registro.aoMudar[0]?.('');

    await Promise.resolve();
    expect(enviados).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('não assina ouvinte nenhum sem credencial', () => {
    const { notificador, registro } = fingirNotificador();
    registrarQuandoAssinar(dependencias(notificador, { credenciais: null }));
    expect(registro.aoMudar).toHaveLength(0);
  });
});

describe('ouvirToques', () => {
  const loja = { urlDaLoja: 'https://oakvintage.com.br', dominios: ['oakvintage.com.br'] };

  it('leva ao caminho anunciado na notificação', () => {
    const { notificador, registro } = fingirNotificador();
    const destinos: DestinoDoPush[] = [];
    ouvirToques(notificador, loja, (d) => destinos.push(d));

    registro.aoTocar[0]?.({ additionalData: { deep_link: '/promocoes' } });
    expect(destinos).toEqual([{ destino: 'caminho', caminho: '/promocoes' }]);
  });

  it('notificação sem link só abre o app', () => {
    const { notificador, registro } = fingirNotificador();
    const destinos: DestinoDoPush[] = [];
    ouvirToques(notificador, loja, (d) => destinos.push(d));

    registro.aoTocar[0]?.({});
    expect(destinos).toEqual([{ destino: 'abrir' }]);
  });

  it('link de fora NÃO abre WebView com a cara da loja', () => {
    const { notificador, registro } = fingirNotificador();
    const destinos: DestinoDoPush[] = [];
    ouvirToques(notificador, loja, (d) => destinos.push(d));

    registro.aoTocar[0]?.({ additionalData: { deep_link: 'https://site-falso.com/entrar' } });
    expect(destinos).toEqual([{ destino: 'abrir' }]);
  });
});

describe('carrinhoMudou', () => {
  it('marca as tags E conta ao servidor', async () => {
    const { notificador, registro } = fingirNotificador();
    const { buscador, enviados } = fingirRede();
    vi.stubGlobal('fetch', buscador);

    await carrinhoMudou(dependencias(notificador), 'sub-1', {
      count: 2,
      totalCents: 9900,
      quandoMs: 1_800_000_000_000,
      token: 'tok',
      currency: 'BRL',
    });

    expect(registro.tags).toContainEqual(
      expect.objectContaining({ cart_count: '2', cart_value: '9900' }),
    );
    expect(enviados[0]?.url).toContain('/api/public/events');
    expect(enviados[0]?.corpo).toMatchObject({
      event: 'update',
      itemCount: 2,
      cartToken: 'tok',
      valueCents: 9900,
      currency: 'BRL',
    });

    vi.unstubAllGlobals();
  });

  it('manda o carrinho zerado, que é o que cancela o push', async () => {
    const { notificador } = fingirNotificador();
    const { buscador, enviados } = fingirRede();
    vi.stubGlobal('fetch', buscador);

    await carrinhoMudou(dependencias(notificador), 'sub-1', { count: 0, quandoMs: 1 });
    expect(enviados[0]?.corpo).toMatchObject({ itemCount: 0 });

    vi.unstubAllGlobals();
  });

  it('sem inscrição não manda evento: ele ficaria sem dono', async () => {
    const { notificador } = fingirNotificador();
    const { buscador, enviados } = fingirRede();
    vi.stubGlobal('fetch', buscador);

    await carrinhoMudou(dependencias(notificador), null, { count: 2, quandoMs: 1 });
    expect(enviados).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it('não lança quando a rede cai no meio da compra', async () => {
    const { notificador } = fingirNotificador();
    const quebrado = (() => Promise.reject(new Error('sem rede'))) as unknown as typeof fetch;
    vi.stubGlobal('fetch', quebrado);

    await expect(
      carrinhoMudou(dependencias(notificador), 'sub-1', { count: 1, quandoMs: 1 }),
    ).resolves.toBeUndefined();

    vi.unstubAllGlobals();
  });
});

describe('checkoutIniciado', () => {
  it('conta o checkout com o token do carrinho', async () => {
    const { notificador } = fingirNotificador();
    const { buscador, enviados } = fingirRede();
    vi.stubGlobal('fetch', buscador);

    await checkoutIniciado(dependencias(notificador), 'sub-1', 'tok-1', 3);
    expect(enviados[0]?.corpo).toMatchObject({
      event: 'checkout_started',
      cartToken: 'tok-1',
      itemCount: 3,
    });

    vi.unstubAllGlobals();
  });
});

describe('pedidoConcluido', () => {
  /*
   * Este é o evento que cancela o carrinho abandonado. Falhar aqui significa
   * mandar "você esqueceu algo no carrinho" para quem acabou de pagar.
   */
  it('marca a compra e manda o evento que cancela o push', async () => {
    const { notificador, registro } = fingirNotificador();
    const { buscador, enviados } = fingirRede();
    vi.stubGlobal('fetch', buscador);

    const ok = await pedidoConcluido(dependencias(notificador), 'sub-1', {
      totalCents: 15_000,
      currency: 'BRL',
    });

    expect(ok).toBe(true);
    expect(registro.tags).toContainEqual(
      expect.objectContaining({ has_purchased: 'true', cart_count: '0' }),
    );
    expect(enviados[0]?.corpo).toMatchObject({ event: 'purchased', itemCount: 0 });

    vi.unstubAllGlobals();
  });

  it('diz que NÃO deu certo quando o servidor recusa', async () => {
    const { notificador } = fingirNotificador();
    const { buscador } = fingirRede(503);
    vi.stubGlobal('fetch', buscador);

    await expect(
      pedidoConcluido(dependencias(notificador), 'sub-1', { totalCents: 100 }),
    ).resolves.toBe(false);

    vi.unstubAllGlobals();
  });

  it('diz que não deu certo sem inscrição, em vez de fingir sucesso', async () => {
    const { notificador } = fingirNotificador();
    await expect(
      pedidoConcluido(dependencias(notificador), null, { totalCents: 100 }),
    ).resolves.toBe(false);
  });
});

describe('identificarCliente', () => {
  it('identifica quem entrou na conta', () => {
    const { notificador, registro } = fingirNotificador();
    identificarCliente(notificador, 'cliente-42');
    expect(registro.identificados).toEqual(['cliente-42']);
  });

  it('esquece quem saiu da conta', () => {
    const { notificador, registro } = fingirNotificador();
    identificarCliente(notificador, undefined);
    identificarCliente(notificador, '   ');
    expect(registro.esqueceu).toBe(2);
    expect(registro.identificados).toEqual([]);
  });

  it('não lança quando o SDK recusa', () => {
    const { notificador } = fingirNotificador();
    const quebrado: Notificador = {
      ...notificador,
      identificar: () => {
        throw new Error('sem usuário');
      },
    };
    expect(() => {
      identificarCliente(quebrado, 'x');
    }).not.toThrow();
  });
});

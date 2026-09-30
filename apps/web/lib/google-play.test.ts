/**
 * Onde a versão está na Play Store (C12): as trilhas lidas pela conta de
 * serviço do lojista e a página pública do app, com um `fetch` falso que
 * responde como a API da Google — e confere que a edição aberta é apagada.
 */
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { URL_DO_TOKEN } from '@/lib/google';
import { BASE_DA_PLAY, consultarPlay, estadoNaPlay, lerTrilhaDeProducao } from '@/lib/google-play';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const CONTA = JSON.stringify({
  type: 'service_account',
  client_email: 'storefy@loja-123.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
});
const PACOTE = 'br.com.loja';
const APP = `${BASE_DA_PLAY}/applications/${PACOTE}`;
const PAGINA = `https://play.google.com/store/apps/details?id=${PACOTE}&hl=pt_BR`;

function trilhas(producao: { status: string; versionCodes: string[] }[]) {
  return {
    tracks: [
      { track: 'internal', releases: [{ status: 'completed', versionCodes: ['7'] }] },
      { track: 'production', releases: producao },
    ],
  };
}

/** Um `fetch` falso por URL exata; registra método e endereço de cada pedido. */
function falsa(
  respostas: Record<string, { status: number; corpo?: unknown }>,
  pedidos: string[] = [],
): typeof fetch {
  return (entrada, init) => {
    const url = entrada instanceof Request ? entrada.url : entrada.toString();
    pedidos.push(`${init?.method ?? 'GET'} ${url}`);
    const resposta = respostas[`${init?.method ?? 'GET'} ${url}`];
    const status = resposta?.status ?? 404;
    return Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(resposta?.corpo ?? {}), { status }),
    );
  };
}

const BASE = {
  [`POST ${URL_DO_TOKEN}`]: { status: 200, corpo: { access_token: 'ya29.token' } },
  [`POST ${APP}/edits`]: { status: 200, corpo: { id: 'edicao-1' } },
  [`DELETE ${APP}/edits/edicao-1`]: { status: 204 },
};

describe('lerTrilhaDeProducao', () => {
  it('pega as versões da produção, com os números como número', () => {
    expect(lerTrilhaDeProducao(trilhas([{ status: 'draft', versionCodes: ['7', '8'] }]))).toEqual([
      { status: 'draft', versionCodes: [7, 8] },
    ]);
  });

  it('resposta estranha vira lista vazia, e não exceção', () => {
    for (const corpo of [null, 'x', {}, { tracks: 'x' }, { tracks: [{ track: 'internal' }] }]) {
      expect(lerTrilhaDeProducao(corpo)).toEqual([]);
    }
  });
});

describe('estadoNaPlay', () => {
  const producao = (status: string, codigos: number[]) => [{ status, versionCodes: codigos }];

  it('só no teste interno: a vez é do lojista, e o build fica onde está', () => {
    expect(estadoNaPlay({ producao: [], versionCode: 7, publicado: false })).toEqual({
      estado: 'PLAY_INTERNAL',
      status: null,
    });
  });

  it('rascunho e interrompido também são a vez do lojista', () => {
    expect(
      estadoNaPlay({ producao: producao('draft', [7]), versionCode: 7, publicado: true }).estado,
    ).toBe('PLAY_PRODUCTION_DRAFT');
    expect(
      estadoNaPlay({ producao: producao('halted', [7]), versionCode: 7, publicado: true }).estado,
    ).toBe('PLAY_HALTED');
  });

  it('enviada à produção e o app ainda fechado: a Google está revisando', () => {
    expect(
      estadoNaPlay({ producao: producao('completed', [7]), versionCode: 7, publicado: false }),
    ).toEqual({ estado: 'PLAY_PRODUCTION', status: 'in_review' });
  });

  it('em produção com o app aberto na Play Store: aprovado', () => {
    expect(
      estadoNaPlay({ producao: producao('inProgress', [7]), versionCode: 7, publicado: true }),
    ).toEqual({ estado: 'PLAY_LIVE', status: 'approved' });
  });

  it('uma versão mais nova na produção substitui esta', () => {
    expect(
      estadoNaPlay({ producao: producao('completed', [9]), versionCode: 7, publicado: true }),
    ).toEqual({ estado: 'PLAY_REPLACED', status: null });
  });
});

describe('consultarPlay', () => {
  it('lê as trilhas, olha a página pública e apaga a edição que abriu', async () => {
    const pedidos: string[] = [];
    const resultado = await consultarPlay(
      CONTA,
      PACOTE,
      7,
      falsa(
        {
          ...BASE,
          [`GET ${APP}/edits/edicao-1/tracks`]: {
            status: 200,
            corpo: trilhas([{ status: 'completed', versionCodes: ['7'] }]),
          },
          [`GET ${PAGINA}`]: { status: 200 },
        },
        pedidos,
      ),
    );

    expect(resultado).toEqual({ ok: true, estado: 'PLAY_LIVE', status: 'approved' });
    expect(pedidos).toContain(`DELETE ${APP}/edits/edicao-1`);
  });

  it('versão ainda no teste interno nem abre a página pública', async () => {
    const pedidos: string[] = [];
    const resultado = await consultarPlay(
      CONTA,
      PACOTE,
      7,
      falsa(
        { ...BASE, [`GET ${APP}/edits/edicao-1/tracks`]: { status: 200, corpo: trilhas([]) } },
        pedidos,
      ),
    );
    expect(resultado).toEqual({ ok: true, estado: 'PLAY_INTERNAL', status: null });
    expect(pedidos.some((pedido) => pedido.includes('play.google.com/store'))).toBe(false);
  });

  it('página pública fechada (404): enviada, e a Google revisando', async () => {
    const resultado = await consultarPlay(
      CONTA,
      PACOTE,
      7,
      falsa({
        ...BASE,
        [`GET ${APP}/edits/edicao-1/tracks`]: {
          status: 200,
          corpo: trilhas([{ status: 'completed', versionCodes: ['7'] }]),
        },
        [`GET ${PAGINA}`]: { status: 404 },
      }),
    );
    expect(resultado).toEqual({ ok: true, estado: 'PLAY_PRODUCTION', status: 'in_review' });
  });

  /*
   * A distinção importa: passageira não aparece para o lojista, porque a
   * próxima hora resolve; permanente precisa aparecer, com o que fazer.
   */
  it('conta sem acesso ao app é permanente, e diz onde dar o acesso', async () => {
    const pedidos: string[] = [];
    const resultado = await consultarPlay(
      CONTA,
      PACOTE,
      7,
      falsa({ ...BASE, [`POST ${APP}/edits`]: { status: 403 } }, pedidos),
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.passageiro).toBe(false);
      expect(resultado.motivo).toContain('Usuários e permissões');
    }
  });

  it('Google instável é passageira; token recusado pede reconectar', async () => {
    const instavel = await consultarPlay(
      CONTA,
      PACOTE,
      7,
      falsa({ ...BASE, [`POST ${APP}/edits`]: { status: 503 } }),
    );
    expect(instavel).toMatchObject({ ok: false, passageiro: true });

    const recusada = await consultarPlay(
      CONTA,
      PACOTE,
      7,
      falsa({ [`POST ${URL_DO_TOKEN}`]: { status: 400, corpo: { error: 'invalid_grant' } } }),
    );
    expect(recusada.ok).toBe(false);
    if (!recusada.ok) {
      expect(recusada.passageiro).toBe(false);
      expect(recusada.motivo).toContain('Reconecte a conta Google');
    }
  });

  it('arquivo da conta que não abre, e rede fora do ar, não viram exceção', async () => {
    const semConta = await consultarPlay('isto não é json', PACOTE, 7, falsa({}));
    expect(semConta).toMatchObject({ ok: false, passageiro: false });

    const semRede = await consultarPlay(CONTA, PACOTE, 7, () =>
      Promise.reject(new Error('sem rede')),
    );
    expect(semRede).toMatchObject({ ok: false, passageiro: true });
  });
});

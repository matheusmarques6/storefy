import { describe, expect, it } from 'vitest';
import { BASE_DA_API } from '@/lib/apple';
import {
  consultarRevisao,
  lerEstadoDaVersao,
  lerIdDoApp,
  mensagemDaRevisao,
  traduzirEstadoDaApple,
} from '@/lib/revisao';

/** Uma chave .p8 de verdade, gerada aqui, para o token poder ser assinado. */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const P8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const CHAVE = { p8: P8, keyId: 'KEY123', issuerId: 'ISS-456' };

describe('traduzirEstadoDaApple', () => {
  it('em revisão é em revisão', () => {
    expect(traduzirEstadoDaApple('IN_REVIEW')).toBe('in_review');
    expect(traduzirEstadoDaApple('in_review')).toBe('in_review');
    expect(traduzirEstadoDaApple('  IN_REVIEW  ')).toBe('in_review');
  });

  /*
   * `PENDING_DEVELOPER_RELEASE` conta como aprovado de propósito: a Apple já
   * disse sim, e o que falta é um clique do lojista. Deixá-lo em "em revisão"
   * esconderia justamente o momento em que ele precisa agir.
   */
  it('a Apple já tendo dito sim conta como aprovado', () => {
    for (const estado of [
      'READY_FOR_SALE',
      'PENDING_DEVELOPER_RELEASE',
      'PENDING_APPLE_RELEASE',
      'APPROVED',
    ]) {
      expect(traduzirEstadoDaApple(estado)).toBe('approved');
    }
  });

  it('as quatro formas de recusa são recusa', () => {
    for (const estado of [
      'REJECTED',
      'METADATA_REJECTED',
      'DEVELOPER_REJECTED',
      'INVALID_BINARY',
    ]) {
      expect(traduzirEstadoDaApple(estado)).toBe('rejected');
    }
  });

  /*
   * Estes são estados de TRÂNSITO: o app ainda vai ser submetido, ou está
   * sendo processado. Movê-los para algum dos nossos contaria ao lojista uma
   * decisão que ninguém tomou.
   */
  it('estado de trânsito e estado desconhecido não mudam nada', () => {
    for (const estado of [
      'PREPARE_FOR_SUBMISSION',
      'PROCESSING_FOR_APP_STORE',
      'WAITING_FOR_REVIEW',
      'REPLACED_WITH_NEW_VERSION',
      'DEVELOPER_REMOVED_FROM_SALE',
      'ESTADO_QUE_A_APPLE_INVENTOU_ONTEM',
      '',
    ]) {
      expect(traduzirEstadoDaApple(estado)).toBeNull();
    }
  });
});

describe('mensagemDaRevisao', () => {
  it('aprovado e em revisão não carregam mensagem de erro', () => {
    expect(mensagemDaRevisao('approved', 'READY_FOR_SALE')).toBeNull();
    expect(mensagemDaRevisao('in_review', 'IN_REVIEW')).toBeNull();
  });

  /*
   * Cada recusa tem um conserto diferente, e mandar o lojista para o lugar
   * errado custa mais um ciclo de revisão — de um a três dias.
   */
  it('cada recusa manda o lojista para o lugar certo', () => {
    expect(mensagemDaRevisao('rejected', 'METADATA_REJECTED')).toContain('ficha do app');
    expect(mensagemDaRevisao('rejected', 'INVALID_BINARY')).toContain('Publique de novo');
    expect(mensagemDaRevisao('rejected', 'DEVELOPER_REJECTED')).toContain('sua equipe');
    expect(mensagemDaRevisao('rejected', 'REJECTED')).toContain('Resolution Center');
  });

  it('recusa desconhecida ainda diz onde ver o motivo', () => {
    expect(mensagemDaRevisao('rejected', 'QUALQUER_COISA')).toContain('App Store Connect');
  });
});

describe('lerEstadoDaVersao', () => {
  it('lê o campo antigo', () => {
    const corpo = {
      data: [{ attributes: { appStoreState: 'IN_REVIEW', versionString: '1.2.0' } }],
    };
    expect(lerEstadoDaVersao(corpo)).toEqual({ estado: 'IN_REVIEW', versao: '1.2.0' });
  });

  /*
   * `appStoreState` é o campo antigo e `appVersionState` o novo; qual deles vem
   * depende da versão da API que a conta recebe. Ler só um deles daria um cron
   * que roda de hora em hora sem nunca achar nada.
   */
  it('lê o campo novo', () => {
    const corpo = { data: [{ attributes: { appVersionState: 'READY_FOR_SALE' } }] };
    expect(lerEstadoDaVersao(corpo)).toEqual({ estado: 'READY_FOR_SALE', versao: '' });
  });

  it('resposta sem versão nenhuma não é erro, é null', () => {
    for (const corpo of [
      null,
      {},
      { data: [] },
      { data: [{}] },
      { data: [{ attributes: {} }] },
      { data: [{ attributes: { appStoreState: '' } }] },
      { data: 'nada disso' },
      'texto',
    ]) {
      expect(lerEstadoDaVersao(corpo)).toBeNull();
    }
  });
});

describe('lerIdDoApp', () => {
  it('pega o id do primeiro app', () => {
    expect(lerIdDoApp({ data: [{ id: '123456' }] })).toBe('123456');
  });

  it('bundle sem app na conta vira null', () => {
    for (const corpo of [null, {}, { data: [] }, { data: [{}] }, { data: [{ id: '' }] }]) {
      expect(lerIdDoApp(corpo)).toBeNull();
    }
  });
});

describe('consultarRevisao', () => {
  /** Um `fetch` falso que responde por caminho e registra o que foi pedido. */
  function falsa(
    respostas: Record<string, { status: number; corpo: unknown }>,
    pedidos: string[] = [],
  ): typeof fetch {
    return (entrada, init) => {
      const url = entrada instanceof Request ? entrada.url : entrada.toString();
      pedidos.push(url);
      // O token vai no cabeçalho, sempre.
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      if (!auth.startsWith('Bearer ey')) {
        return Promise.resolve(new Response('{}', { status: 401 }));
      }

      const chave = Object.keys(respostas).find((c) => url.includes(c));
      const r = chave === undefined ? { status: 404, corpo: {} } : respostas[chave];
      return Promise.resolve(
        new Response(JSON.stringify(r?.corpo ?? {}), { status: r?.status ?? 404 }),
      );
    };
  }

  it('encontra o app pelo bundle e devolve o estado da versão', async () => {
    const pedidos: string[] = [];
    const resultado = await consultarRevisao(
      CHAVE,
      'br.com.loja',
      falsa(
        {
          '/v1/apps?filter': { status: 200, corpo: { data: [{ id: 'app-1' }] } },
          '/appStoreVersions': {
            status: 200,
            corpo: { data: [{ attributes: { appStoreState: 'IN_REVIEW', versionString: '1.0' } }] },
          },
        },
        pedidos,
      ),
    );

    expect(resultado).toEqual({
      ok: true,
      status: 'in_review',
      estado: 'IN_REVIEW',
      versao: '1.0',
    });
    expect(pedidos[0]).toBe(`${BASE_DA_API}/v1/apps?filter[bundleId]=br.com.loja&limit=1`);
    expect(pedidos[1]).toContain('/v1/apps/app-1/appStoreVersions');
  });

  /** O bundle entra na URL; um valor com caractere especial não pode escapar. */
  it('escapa o bundle na consulta', async () => {
    const pedidos: string[] = [];
    await consultarRevisao(
      CHAVE,
      'br.com/loja?x=1',
      falsa({ '/v1/apps?filter': { status: 200, corpo: { data: [] } } }, pedidos),
    );
    expect(pedidos[0]).toContain('br.com%2Floja%3Fx%3D1');
  });

  it('app fora da conta vira falha permanente com instrução', async () => {
    const r = await consultarRevisao(
      CHAVE,
      'br.com.loja',
      falsa({ '/v1/apps?filter': { status: 200, corpo: { data: [] } } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.passageiro).toBe(false);
      expect(r.motivo).toContain('App Store Connect');
    }
  });

  /*
   * A distinção importa: uma falha PASSAGEIRA não pode virar erro na tela,
   * porque a próxima hora resolve sozinha. Uma permanente precisa aparecer,
   * senão o build fica "enviado" para sempre.
   */
  it('separa a Apple instável da loja com chave revogada', async () => {
    for (const status of [429, 500, 502, 503]) {
      const r = await consultarRevisao(
        CHAVE,
        'br.com.loja',
        falsa({ '/v1/apps?filter': { status, corpo: {} } }),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.passageiro).toBe(true);
    }

    for (const status of [401, 403]) {
      const r = await consultarRevisao(
        CHAVE,
        'br.com.loja',
        falsa({ '/v1/apps?filter': { status, corpo: {} } }),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.passageiro).toBe(false);
        expect(r.motivo).toContain('Reconecte');
      }
    }
  });

  it('app sem nenhuma versão ainda não é erro', async () => {
    const r = await consultarRevisao(
      CHAVE,
      'br.com.loja',
      falsa({
        '/v1/apps?filter': { status: 200, corpo: { data: [{ id: 'app-1' }] } },
        '/appStoreVersions': { status: 200, corpo: { data: [] } },
      }),
    );
    expect(r).toEqual({ ok: true, status: null, estado: '', versao: '' });
  });

  it('chave que não assina vira falha permanente, e não exceção', async () => {
    const r = await consultarRevisao(
      { p8: 'isto não é uma chave', keyId: 'K', issuerId: 'I' },
      'br.com.loja',
      falsa({}),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.passageiro).toBe(false);
  });

  it('rede fora do ar vira falha passageira', async () => {
    const r = await consultarRevisao(CHAVE, 'br.com.loja', () =>
      Promise.reject(new Error('sem rede')),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.passageiro).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { passosPendentes, situacaoNaLoja, type BuildNaLoja } from '@/lib/ultimo-passo';

const IOS: BuildNaLoja = {
  platform: 'ios',
  status: 'submitted',
  storeState: null,
  version: '1.0.4',
  buildNumber: 4,
};
const ANDROID: BuildNaLoja = { ...IOS, platform: 'android', version: '1.0.5', buildNumber: 5 };
const CONTEXTO = { iosAscAppId: '6478123456' };

describe('situacaoNaLoja — Apple', () => {
  /* O defeito: a tela dizia "aguardar a revisão", e ninguém estava revisando. */
  it('binário na App Store Connect sem envio: a vez é do lojista, com o passo a passo', () => {
    for (const storeState of [null, 'PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW']) {
      const situacao = situacaoNaLoja({ ...IOS, storeState }, CONTEXTO);
      expect(situacao?.vez, String(storeState)).toBe('lojista');
      expect(situacao?.explicacao).toContain('Falta você enviar para a revisão');
      expect(situacao?.passo?.passos.join(' ')).toContain('1.0.4 (4)');
      expect(situacao?.passo?.link.url).toBe(
        'https://appstoreconnect.apple.com/apps/6478123456/distribution',
      );
    }
  });

  it('sem o número do app na Apple, o link abre a lista de apps', () => {
    expect(situacaoNaLoja(IOS, { iosAscAppId: null })?.passo?.link.url).toBe(
      'https://appstoreconnect.apple.com/apps',
    );
  });

  it('sem a versão daquele número na App Store Connect, diz para criar ou renumerar', () => {
    const situacao = situacaoNaLoja({ ...IOS, storeState: 'NO_APP_STORE_VERSION' }, CONTEXTO);
    expect(situacao?.vez).toBe('lojista');
    expect(situacao?.passo?.titulo).toBe('Falta a versão 1.0.4 na App Store Connect');
    expect(situacao?.passo?.passos.join(' ')).toContain('troque o número dela para 1.0.4');
  });

  it('na fila e em revisão: a vez é da Apple, sem passo', () => {
    expect(situacaoNaLoja({ ...IOS, storeState: 'WAITING_FOR_REVIEW' }, CONTEXTO)).toMatchObject({
      vez: 'loja',
      passo: null,
    });
    expect(
      situacaoNaLoja({ ...IOS, status: 'in_review', storeState: 'IN_REVIEW' }, CONTEXTO),
    ).toMatchObject({ vez: 'loja', passo: null });
  });

  it('aprovado esperando liberar pede o clique; na loja, acabou', () => {
    const esperando = situacaoNaLoja(
      { ...IOS, status: 'approved', storeState: 'PENDING_DEVELOPER_RELEASE' },
      CONTEXTO,
    );
    expect(esperando?.vez).toBe('lojista');
    expect(esperando?.passo?.passos.join(' ')).toContain('Liberar esta versão');

    expect(
      situacaoNaLoja({ ...IOS, status: 'approved', storeState: 'READY_FOR_SALE' }, CONTEXTO),
    ).toMatchObject({ vez: 'ninguem', passo: null });
  });

  it('criptografia e contratos também são passos do lojista', () => {
    expect(
      situacaoNaLoja({ ...IOS, storeState: 'WAITING_FOR_EXPORT_COMPLIANCE' }, CONTEXTO)?.passo,
    ).not.toBeNull();
    expect(
      situacaoNaLoja({ ...IOS, storeState: 'PENDING_CONTRACT' }, CONTEXTO)?.passo,
    ).not.toBeNull();
  });

  it('estado que não conhecemos não inventa passo', () => {
    expect(situacaoNaLoja({ ...IOS, storeState: 'ALGO_NOVO' }, CONTEXTO)).toMatchObject({
      vez: 'loja',
      passo: null,
    });
  });

  it('build que não chegou à loja não tem situação na loja', () => {
    for (const status of ['queued', 'building', 'finished', 'errored', 'canceled'] as const) {
      expect(situacaoNaLoja({ ...IOS, status }, CONTEXTO), status).toBeNull();
    }
  });
});

describe('situacaoNaLoja — Google', () => {
  it('no teste interno: falta publicar em produção, com a versão para escolher', () => {
    for (const storeState of [null, 'PLAY_INTERNAL']) {
      const situacao = situacaoNaLoja({ ...ANDROID, storeState }, CONTEXTO);
      expect(situacao?.vez).toBe('lojista');
      expect(situacao?.explicacao).toContain('teste interno');
      expect(situacao?.passo?.passos.join(' ')).toContain('1.0.5 (5)');
      expect(situacao?.passo?.link.url).toBe('https://play.google.com/console');
    }
  });

  it('rascunho e lançamento interrompido pedem o lojista', () => {
    expect(situacaoNaLoja({ ...ANDROID, storeState: 'PLAY_PRODUCTION_DRAFT' }, CONTEXTO)?.vez).toBe(
      'lojista',
    );
    expect(situacaoNaLoja({ ...ANDROID, storeState: 'PLAY_HALTED' }, CONTEXTO)?.vez).toBe(
      'lojista',
    );
  });

  it('em produção: a Google revisa; aberto na loja, acabou', () => {
    expect(
      situacaoNaLoja({ ...ANDROID, status: 'in_review', storeState: 'PLAY_PRODUCTION' }, CONTEXTO),
    ).toMatchObject({ vez: 'loja', passo: null });
    expect(
      situacaoNaLoja({ ...ANDROID, status: 'approved', storeState: 'PLAY_LIVE' }, CONTEXTO),
    ).toMatchObject({ vez: 'ninguem', passo: null });
  });
});

describe('passosPendentes', () => {
  it('só a versão mais nova de cada loja conta', () => {
    const pendentes = passosPendentes(
      [
        // A antiga parada em "Preparar para envio" não é mais o que resolver.
        { ...IOS, buildNumber: 3, storeState: 'PREPARE_FOR_SUBMISSION', createdAt: '2026-09-01' },
        { ...IOS, status: 'in_review', storeState: 'IN_REVIEW', createdAt: '2026-09-20' },
        { ...ANDROID, storeState: 'PLAY_INTERNAL', createdAt: '2026-09-21' },
      ],
      CONTEXTO,
    );
    expect(pendentes.map((pendente) => pendente.plataforma)).toEqual(['android']);
  });

  it('build na fila ou gerando não entra na conta', () => {
    expect(
      passosPendentes([{ ...IOS, status: 'building', createdAt: '2026-09-21' }], CONTEXTO),
    ).toEqual([]);
  });
});

import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CorpoDoEas,
  conferirAssinaturaDoEas,
  mensagemDoErro,
  montarAtualizacao,
  numeroDoBuild,
  traduzirStatus,
  urlDosLogs,
  versaoDoBuild,
} from '@/lib/eas-webhook';

const CHAVE = Buffer.alloc(32, 19).toString('base64');
const SEGREDO = 'segredo-do-webhook';
let original: string | undefined;

beforeEach(() => {
  original = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = CHAVE;
});
afterEach(() => {
  if (original === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = original;
});

const assinar = (corpo: string, segredo = SEGREDO): string =>
  `sha1=${createHmac('sha1', segredo).update(corpo).digest('hex')}`;

/** Um payload do EAS já validado, para os testes que partem dele. */
const analisar = (bruto: unknown): CorpoDoEas => {
  const r = CorpoDoEas.safeParse(bruto);
  if (!r.success) throw new Error(`payload inválido no teste: ${r.error.message}`);
  return r.data;
};

describe('conferirAssinaturaDoEas', () => {
  const corpo = JSON.stringify({ id: 'b1', status: 'finished' });

  it('aceita a assinatura do EAS', () => {
    expect(conferirAssinaturaDoEas(assinar(corpo), SEGREDO, corpo)).toEqual({ ok: true });
  });

  it('recusa assinatura de outro segredo', () => {
    const r = conferirAssinaturaDoEas(assinar(corpo, 'outro'), SEGREDO, corpo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  /*
   * O corpo é conferido como TEXTO. Reserializar o JSON mudaria um espaço e a
   * assinatura deixaria de bater — e o sintoma seria "o webhook parou de
   * funcionar", sem nada nos logs.
   */
  it('recusa quando o corpo muda, mesmo com o mesmo JSON', () => {
    const reescrito = JSON.stringify(JSON.parse(corpo), null, 2);
    expect(JSON.parse(reescrito)).toEqual(JSON.parse(corpo));

    const r = conferirAssinaturaDoEas(assinar(corpo), SEGREDO, reescrito);
    expect(r.ok).toBe(false);
  });

  it('sem segredo configurado, recusa com 503', () => {
    for (const segredo of [undefined, '']) {
      const r = conferirAssinaturaDoEas(assinar(corpo), segredo, corpo);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(503);
    }
  });

  it('sem cabeçalho, recusa', () => {
    for (const cabecalho of [null, '', '   ']) {
      expect(conferirAssinaturaDoEas(cabecalho, SEGREDO, corpo).ok).toBe(false);
    }
  });

  it('não aceita a assinatura sem o prefixo do algoritmo', () => {
    const semPrefixo = assinar(corpo).replace('sha1=', '');
    expect(conferirAssinaturaDoEas(semPrefixo, SEGREDO, corpo).ok).toBe(false);
  });
});

describe('traduzirStatus', () => {
  it('traduz os status que o EAS manda', () => {
    expect(traduzirStatus('finished')).toBe('finished');
    expect(traduzirStatus('FINISHED')).toBe('finished');
    expect(traduzirStatus('errored')).toBe('errored');
    expect(traduzirStatus('canceled')).toBe('canceled');
    expect(traduzirStatus('cancelled')).toBe('canceled');
  });

  /*
   * Um status novo inventado pelo EAS não pode virar outra coisa por acidente.
   * Ignorar é mais seguro do que adivinhar: o build fica como estava e o
   * lojista vê o andamento parado, em vez de ver "aprovado" sem ser.
   */
  it('status desconhecido vira null, e não um palpite', () => {
    for (const status of ['in-queue', 'new', 'approved', 'pending', '', 'qualquer']) {
      expect(traduzirStatus(status)).toBeNull();
    }
  });
});

describe('CorpoDoEas', () => {
  it('aceita o mínimo que o EAS manda', () => {
    expect(CorpoDoEas.safeParse({ id: 'b1', status: 'finished' }).success).toBe(true);
  });

  /*
   * Campos a mais passam de propósito: o EAS acrescenta coisas ao payload com
   * o tempo, e recusar o que não conhecemos transformaria uma mudança deles
   * numa queda nossa.
   */
  it('campo novo do EAS não derruba o webhook', () => {
    const r = CorpoDoEas.safeParse({
      id: 'b1',
      status: 'finished',
      campoQueNaoExistiaAntes: { x: 1 },
    });
    expect(r.success).toBe(true);
  });

  it('exige id e status', () => {
    expect(CorpoDoEas.safeParse({ status: 'finished' }).success).toBe(false);
    expect(CorpoDoEas.safeParse({ id: '', status: 'finished' }).success).toBe(false);
    expect(CorpoDoEas.safeParse({ id: 'b1' }).success).toBe(false);
  });

  it('aceita o payload de build inteiro do EAS', () => {
    const r = CorpoDoEas.safeParse({
      id: 'e1',
      accountName: 'convertfy',
      projectName: 'storefy',
      buildDetailsPageUrl: 'https://expo.dev/accounts/convertfy/builds/e1',
      platform: 'ios',
      status: 'finished',
      artifacts: { buildUrl: 'https://exemplo/app.ipa', logsUrl: 'https://exemplo/logs' },
      metadata: { appVersion: '1.2.0', appBuildVersion: '7', buildProfile: 'production' },
      metrics: { buildQueueTime: 12 },
      error: null,
      completedAt: '2026-09-19T12:00:00.000Z',
    });
    expect(r.success).toBe(true);
  });
});

/*
 * A versão e o número do build moram em `metadata` no payload do EAS. Lê-los
 * do topo deixaria a coluna nula em todo build, e a trilha perderia justamente
 * o número pelo qual a Apple e o lojista se entendem quando algo dá errado.
 */
describe('versaoDoBuild e numeroDoBuild', () => {
  it('lê a versão de metadata', () => {
    expect(
      versaoDoBuild(analisar({ id: 'e', status: 'finished', metadata: { appVersion: '2.1.0' } })),
    ).toBe('2.1.0');
  });

  it('lê também do topo, se for de lá que vier', () => {
    expect(versaoDoBuild(analisar({ id: 'e', status: 'finished', appVersion: '3.0.0' }))).toBe(
      '3.0.0',
    );
  });

  it('sem versão nenhuma, devolve undefined para não apagar a coluna', () => {
    expect(versaoDoBuild(analisar({ id: 'e', status: 'finished' }))).toBeUndefined();
    expect(
      versaoDoBuild(analisar({ id: 'e', status: 'finished', metadata: { appVersion: '' } })),
    ).toBeUndefined();
  });

  it('converte o número do build quando ele é um inteiro', () => {
    expect(
      numeroDoBuild(analisar({ id: 'e', status: 'finished', metadata: { appBuildVersion: '42' } })),
    ).toBe(42);
  });

  /*
   * `CFBundleVersion` do iOS pode ser `1.2.3`. `parseInt` devolveria 1 em
   * silêncio e gravaria um número errado na trilha do que foi para a Apple.
   */
  it('número que não é inteiro puro vira undefined, e não um parseInt torto', () => {
    for (const bruto of ['1.2.3', '12a', 'abc', '', '-3', '1e3', '99999999999']) {
      expect(
        numeroDoBuild(
          analisar({ id: 'e', status: 'finished', metadata: { appBuildVersion: bruto } }),
        ),
      ).toBeUndefined();
    }
  });

  /** Espaço em volta do número é do payload, não do lojista: o schema apara. */
  it('número com espaço em volta ainda conta', () => {
    expect(
      numeroDoBuild(
        analisar({ id: 'e', status: 'finished', metadata: { appBuildVersion: ' 7 ' } }),
      ),
    ).toBe(7);
  });
});

describe('urlDosLogs', () => {
  it('prefere a página do build ao arquivo de log', () => {
    const corpo = analisar({
      id: 'e',
      status: 'finished',
      buildDetailsPageUrl: 'https://expo.dev/builds/e',
      artifacts: { logsUrl: 'https://exemplo/logs.txt' },
    });
    expect(urlDosLogs(corpo)).toBe('https://expo.dev/builds/e');
  });

  it('cai no log quando não veio a página', () => {
    const corpo = analisar({
      id: 'e',
      status: 'finished',
      artifacts: { logsUrl: 'https://exemplo/logs.txt' },
    });
    expect(urlDosLogs(corpo)).toBe('https://exemplo/logs.txt');
  });

  /*
   * O link vai para um `href` na tela do lojista. `javascript:` ali seria um
   * XSS entregue por quem conseguisse forjar um payload.
   */
  it('recusa o que não é http', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'ftp://exemplo', 'expo.dev/x']) {
      expect(urlDosLogs(analisar({ id: 'e', status: 'finished', buildDetailsPageUrl: url }))).toBe(
        undefined,
      );
    }
  });
});

describe('mensagemDoErro', () => {
  /*
   * A mensagem crua do EAS costuma ser um stack de Gradle ou de Xcode. Quando
   * dá para reconhecer a causa, ela vira uma instrução que o lojista consegue
   * seguir sozinho.
   */
  it('erro de credencial vira instrução de reconectar', () => {
    for (const erro of [
      { errorCode: 'EAS_BUILD_CREDENTIALS_ERROR' },
      { message: 'No valid provisioning profile found' },
      { message: 'Certificate has expired' },
    ]) {
      expect(mensagemDoErro(erro)).toContain('Reconecte');
    }
  });

  it('fila cheia vira instrução de tentar depois', () => {
    expect(mensagemDoErro({ errorCode: 'QUOTA_EXCEEDED' })).toContain('alguns minutos');
  });

  it('imagem recusada vira a instrução do ícone', () => {
    expect(mensagemDoErro({ message: 'Invalid icon dimensions: 512x512' })).toContain('1024');
  });

  /*
   * O que não dá para reconhecer passa inteiro. Ruim, mas melhor do que "algo
   * deu errado": o suporte consegue procurar pela mensagem.
   */
  it('erro desconhecido passa como veio', () => {
    expect(mensagemDoErro({ message: 'Gradle task assembleRelease failed' })).toBe(
      'Gradle task assembleRelease failed',
    );
  });

  it('sem erro nenhum, ainda diz algo útil', () => {
    for (const vazio of [null, undefined, {}, { message: '' }]) {
      const mensagem = mensagemDoErro(vazio ?? null);
      expect(mensagem.length).toBeGreaterThan(10);
      expect(mensagem).not.toContain('undefined');
    }
  });

  /** A coluna é texto livre, mas um stack de 2 MB não ajuda ninguém. */
  it('corta mensagem gigante', () => {
    expect(mensagemDoErro({ message: 'x'.repeat(9000) }).length).toBe(2000);
  });
});

describe('montarAtualizacao', () => {
  const agora = '2026-09-19T12:00:00.000Z';

  it('fecha o build com o que o EAS mandou', () => {
    const corpo = analisar({
      id: 'e1',
      status: 'finished',
      buildDetailsPageUrl: 'https://expo.dev/builds/e1',
      metadata: { appVersion: '1.4.0', appBuildVersion: '9' },
    });

    expect(montarAtualizacao(corpo, 'finished', agora)).toEqual({
      status: 'finished',
      finished_at: agora,
      version: '1.4.0',
      build_number: 9,
      logs_url: 'https://expo.dev/builds/e1',
      error: undefined,
    });
  });

  it('build que falhou leva a mensagem traduzida', () => {
    const corpo = analisar({
      id: 'e1',
      status: 'errored',
      error: { errorCode: 'EAS_BUILD_CREDENTIALS_ERROR', message: 'sem perfil' },
    });

    expect(montarAtualizacao(corpo, 'errored', agora).error).toContain('Reconecte');
  });

  /*
   * Os campos ausentes saem `undefined`, e não `null`: o supabase-js não
   * serializa `undefined`, então a coluna fica como estava. `null` apagaria o
   * `logs_url` que o workflow gravou ao pôr o build na fila — e o lojista
   * perderia justamente o link de onde ver o que aconteceu.
   */
  it('o que o EAS não mandou não vira null', () => {
    const atualizacao = montarAtualizacao(
      analisar({ id: 'e1', status: 'canceled' }),
      'canceled',
      agora,
    );

    expect(atualizacao).toEqual({
      status: 'canceled',
      finished_at: agora,
      version: undefined,
      build_number: undefined,
      logs_url: undefined,
      error: undefined,
    });
    expect(JSON.parse(JSON.stringify(atualizacao))).toEqual({
      status: 'canceled',
      finished_at: agora,
    });
  });

  it('build cancelado não ganha mensagem de erro', () => {
    const corpo = analisar({ id: 'e1', status: 'canceled', error: { message: 'interrompido' } });
    expect(montarAtualizacao(corpo, 'canceled', agora).error).toBeUndefined();
  });
});

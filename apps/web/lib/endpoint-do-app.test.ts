import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CorpoDoAparelho,
  CorpoDoEvento,
  TAMANHO_MAXIMO,
  autorizar,
  lerLinhaDoAparelho,
  lerLinhaDoEvento,
  respostaDoAparelho,
  respostaDoEvento,
} from '@/lib/endpoint-do-app';
import { assinar } from '@/lib/assinatura';
import { criptografar } from '@/lib/cripto';

const CHAVE = Buffer.alloc(32, 3).toString('base64');
const SEGREDO = 'segredo-do-app-da-loja';
const APP = '11111111-1111-4111-8111-111111111111';
const AGORA = 1_800_000_000_000;

let chaveOriginal: string | undefined;

beforeEach(() => {
  chaveOriginal = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = CHAVE;
});

afterEach(() => {
  if (chaveOriginal === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = chaveOriginal;
});

/** O banco, fingido: devolve o segredo cifrado do app conhecido. */
const banco = (appId: string): Promise<string | null> =>
  Promise.resolve(appId === APP ? criptografar(SEGREDO) : null);

function corpoDeAparelho(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    appId: APP,
    subscriptionId: 'inscricao-do-onesignal',
    platform: 'ios',
    ...extra,
  });
}

function comAssinatura(corpo: string, segredo = SEGREDO, quando = AGORA): string | null {
  return assinar(segredo, quando, corpo);
}

describe('autorizar', () => {
  it('aceita um corpo bem assinado', async () => {
    const corpo = corpoDeAparelho({ appVersion: '1.2.0' });
    const r = await autorizar(CorpoDoAparelho, corpo, comAssinatura(corpo), banco, AGORA);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dados.appId).toBe(APP);
      expect(r.dados.appVersion).toBe('1.2.0');
    }
  });

  it('recusa sem assinatura', async () => {
    const r = await autorizar(CorpoDoAparelho, corpoDeAparelho(), null, banco, AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.resposta.status).toBe(401);
  });

  it('recusa assinatura de outro segredo', async () => {
    const corpo = corpoDeAparelho();
    const r = await autorizar(
      CorpoDoAparelho,
      corpo,
      comAssinatura(corpo, 'segredo-de-outra-loja'),
      banco,
      AGORA,
    );
    expect(r.ok).toBe(false);
  });

  /*
   * O ponto central do desenho: a assinatura é sobre o TEXTO recebido. Se ela
   * fosse conferida sobre o objeto parseado, trocar o corpo por outro com o
   * mesmo JSON passaria — e trocar `appId` é escrever na loja de outro cliente.
   */
  it('recusa quando o corpo muda depois de assinado', async () => {
    const original = corpoDeAparelho();
    const adulterado = corpoDeAparelho({ subscriptionId: 'inscricao-de-outro' });
    const r = await autorizar(CorpoDoAparelho, adulterado, comAssinatura(original), banco, AGORA);
    expect(r.ok).toBe(false);
  });

  /*
   * O teste preciso de "a assinatura é sobre o TEXTO": estes dois corpos dão
   * exatamente o mesmo objeto depois do JSON.parse. Se a conferência fosse
   * feita sobre o objeto (ou sobre um re-stringify dele), este caso passaria —
   * e com ele passaria qualquer corpo reescrito no meio do caminho.
   */
  it('recusa o mesmo JSON com outro espaçamento: confere o texto, não o objeto', async () => {
    const original = corpoDeAparelho();
    const reescrito = JSON.stringify(JSON.parse(original), null, 2);

    expect(JSON.parse(reescrito)).toEqual(JSON.parse(original));
    expect(reescrito).not.toBe(original);

    const r = await autorizar(CorpoDoAparelho, reescrito, comAssinatura(original), banco, AGORA);
    expect(r.ok).toBe(false);
  });

  it('recusa assinatura vencida', async () => {
    const corpo = corpoDeAparelho();
    const r = await autorizar(
      CorpoDoAparelho,
      corpo,
      comAssinatura(corpo, SEGREDO, AGORA - 10 * 60 * 1000),
      banco,
      AGORA,
    );
    expect(r.ok).toBe(false);
  });

  it('recusa app desconhecido com a MESMA resposta de assinatura errada', async () => {
    const outro = '22222222-2222-4222-8222-222222222222';
    const corpo = JSON.stringify({
      appId: outro,
      subscriptionId: 'x',
      platform: 'ios',
    });
    const desconhecido = await autorizar(
      CorpoDoAparelho,
      corpo,
      comAssinatura(corpo),
      banco,
      AGORA,
    );
    const errada = await autorizar(
      CorpoDoAparelho,
      corpoDeAparelho(),
      comAssinatura(corpoDeAparelho(), 'outro'),
      banco,
      AGORA,
    );

    expect(desconhecido.ok).toBe(false);
    expect(errada.ok).toBe(false);
    // Corpo e status idênticos: o endpoint não diz quais lojas existem.
    if (!desconhecido.ok && !errada.ok) {
      expect(desconhecido.resposta.status).toBe(errada.resposta.status);
      expect(desconhecido.resposta.corpo).toEqual(errada.resposta.corpo);
    }
  });

  it('nunca conta o motivo da recusa no corpo da resposta', async () => {
    const corpo = corpoDeAparelho();
    const casos = [
      await autorizar(CorpoDoAparelho, corpo, null, banco, AGORA),
      await autorizar(CorpoDoAparelho, corpo, comAssinatura(corpo, 'errado'), banco, AGORA),
      await autorizar(
        CorpoDoAparelho,
        corpo,
        comAssinatura(corpo, SEGREDO, AGORA - 10 * 60 * 1000),
        banco,
        AGORA,
      ),
    ];

    for (const caso of casos) {
      expect(caso.ok).toBe(false);
      if (!caso.ok) {
        expect(caso.resposta.corpo).toEqual({ erro: 'nao_autorizado' });
        // O motivo existe, mas só para o log.
        expect(caso.resposta.motivo).toBeTypeOf('string');
        expect(JSON.stringify(caso.resposta.corpo)).not.toContain('assinatura');
      }
    }
  });

  it('recusa corpo grande demais antes de qualquer trabalho', async () => {
    const corpo = corpoDeAparelho({ appVersion: 'a'.repeat(TAMANHO_MAXIMO) });
    const r = await autorizar(CorpoDoAparelho, corpo, comAssinatura(corpo), banco, AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.resposta.status).toBe(413);
  });

  it('recusa json quebrado', async () => {
    const r = await autorizar(CorpoDoAparelho, '{nao é json', comAssinatura('{'), banco, AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.resposta.status).toBe(400);
  });

  it('diz QUAL campo está errado, porque aí quem erra é o app do cliente', async () => {
    const corpo = JSON.stringify({ appId: 'não é uuid', subscriptionId: '', platform: 'web' });
    const r = await autorizar(CorpoDoAparelho, corpo, comAssinatura(corpo), banco, AGORA);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.resposta.status).toBe(400);
      const { campos } = r.resposta.corpo as { campos: string[] };
      expect(campos).toEqual(expect.arrayContaining(['appId', 'subscriptionId', 'platform']));
    }
  });

  it('responde 503, e não 401, quando falta a chave de criptografia', async () => {
    delete process.env.ENCRYPTION_KEY;
    const corpo = corpoDeAparelho();
    const r = await autorizar(CorpoDoAparelho, corpo, 'qualquer', banco, AGORA);

    expect(r.ok).toBe(false);
    // 401 diria ao app "sua assinatura está errada", e ele pararia de tentar.
    if (!r.ok) expect(r.resposta.status).toBe(503);
  });

  it('responde 503 quando o banco falha, sem deixar a exceção escapar', async () => {
    const corpo = corpoDeAparelho();
    const quebrado = (): Promise<string | null> => Promise.reject(new Error('sem conexão'));
    const r = await autorizar(CorpoDoAparelho, corpo, comAssinatura(corpo), quebrado, AGORA);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.resposta.status).toBe(503);
  });

  it('recusa quando o app existe mas ainda não tem segredo', async () => {
    const semSegredo = (): Promise<string | null> => Promise.resolve(null);
    const corpo = corpoDeAparelho();
    const r = await autorizar(CorpoDoAparelho, corpo, comAssinatura(corpo), semSegredo, AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.resposta.status).toBe(401);
  });
});

describe('o corpo do aparelho', () => {
  it('exige um sha256 em emailHash, nunca o e-mail', () => {
    const comEmail = CorpoDoAparelho.safeParse({
      appId: APP,
      subscriptionId: 'x',
      platform: 'ios',
      emailHash: 'cliente@loja.com.br',
    });
    expect(comEmail.success).toBe(false);

    const comHash = CorpoDoAparelho.safeParse({
      appId: APP,
      subscriptionId: 'x',
      platform: 'ios',
      emailHash: 'a'.repeat(64),
    });
    expect(comHash.success).toBe(true);
  });

  it('recusa plataforma fora de ios e android', () => {
    expect(
      CorpoDoAparelho.safeParse({ appId: APP, subscriptionId: 'x', platform: 'web' }).success,
    ).toBe(false);
  });

  it('limita o tamanho da inscrição, que é coluna indexada', () => {
    expect(
      CorpoDoAparelho.safeParse({
        appId: APP,
        subscriptionId: 'x'.repeat(200),
        platform: 'ios',
      }).success,
    ).toBe(false);
  });
});

describe('o corpo do evento', () => {
  const base = { appId: APP, subscriptionId: 'x', event: 'add', itemCount: 2 };

  it('aceita o mínimo que o observador de carrinho manda', () => {
    expect(CorpoDoEvento.safeParse(base).success).toBe(true);
  });

  it('aceita carrinho zerado, que é o sinal de cancelar', () => {
    expect(CorpoDoEvento.safeParse({ ...base, itemCount: 0 }).success).toBe(true);
  });

  it('recusa contagem negativa e valor negativo', () => {
    expect(CorpoDoEvento.safeParse({ ...base, itemCount: -1 }).success).toBe(false);
    expect(CorpoDoEvento.safeParse({ ...base, valueCents: -1 }).success).toBe(false);
  });

  it('recusa contagem quebrada: carrinho não tem meio item', () => {
    expect(CorpoDoEvento.safeParse({ ...base, itemCount: 1.5 }).success).toBe(false);
  });

  it('exige moeda com três letras, como o banco', () => {
    expect(CorpoDoEvento.safeParse({ ...base, currency: 'REAL' }).success).toBe(false);
    expect(CorpoDoEvento.safeParse({ ...base, currency: 'BRL' }).success).toBe(true);
  });

  it('recusa um evento que não existe no banco', () => {
    expect(CorpoDoEvento.safeParse({ ...base, event: 'refunded' }).success).toBe(false);
  });
});

describe('as respostas', () => {
  it('traduz limite em 429, para o app saber que deve esperar', () => {
    expect(
      respostaDoAparelho({ device_id: null, limitado: true, novo: false, boas_vindas: false })
        .status,
    ).toBe(429);
    expect(
      respostaDoEvento({ event_id: null, limitado: true, agendou: false, cancelou: 0 }).status,
    ).toBe(429);
  });

  it('devolve o id do aparelho e se o push de boas-vindas foi agendado', () => {
    const r = respostaDoAparelho({
      device_id: 'abc',
      limitado: false,
      novo: true,
      boas_vindas: true,
    });
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ deviceId: 'abc', novo: true, boasVindas: true });
  });

  it('devolve o que aconteceu com o carrinho', () => {
    const r = respostaDoEvento({ event_id: 'e1', limitado: false, agendou: false, cancelou: 2 });
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ eventId: 'e1', agendou: false, cancelou: 2 });
  });

  it('nunca devolve nada parecido com um segredo', () => {
    const corpos = [
      respostaDoAparelho({ device_id: 'a', limitado: false, novo: true, boas_vindas: false }),
      respostaDoEvento({ event_id: 'b', limitado: false, agendou: true, cancelou: 0 }),
    ];
    for (const r of corpos) {
      const texto = JSON.stringify(r.corpo);
      expect(texto).not.toContain('secret');
      expect(texto).not.toContain('_enc');
      expect(texto).not.toContain(SEGREDO);
    }
  });
});

describe('o retorno do banco', () => {
  const linha = { device_id: null, limitado: true, novo: false, boas_vindas: false };

  it('lê a primeira linha do array que o supabase-js devolve', () => {
    expect(lerLinhaDoAparelho([linha]).status).toBe(429);
    expect(
      lerLinhaDoEvento([
        {
          event_id: '33333333-3333-4333-8333-333333333333',
          limitado: false,
          agendou: true,
          cancelou: 0,
        },
      ]).status,
    ).toBe(200);
  });

  it('aceita também o objeto solto, que é o que .single() devolve', () => {
    expect(lerLinhaDoAparelho(linha).status).toBe(429);
  });

  /*
   * O caso que motivou a validação: os tipos gerados dizem `boolean | null`
   * para toda coluna de `returns table`. Ler o nulo como `false` faria
   * "não foi limitado" e "a função não respondeu" virarem a mesma coisa, e um
   * bug na função apareceria como funcionamento normal.
   */
  it('não lê nulo como falso: vira 503, que é o que de fato aconteceu', () => {
    const r = lerLinhaDoAparelho([{ ...linha, limitado: null }]);
    expect(r.status).toBe(503);
    expect(r.corpo).toEqual({ erro: 'indisponivel' });
  });

  it('recusa retorno vazio', () => {
    expect(lerLinhaDoAparelho([]).status).toBe(503);
    expect(lerLinhaDoEvento(null).status).toBe(503);
  });

  it('recusa um id que não é uuid', () => {
    expect(lerLinhaDoAparelho([{ ...linha, device_id: 'nao-e-uuid' }]).status).toBe(503);
  });

  it('recusa contagem de cancelamentos negativa', () => {
    expect(
      lerLinhaDoEvento([{ event_id: null, limitado: false, agendou: false, cancelou: -1 }]).status,
    ).toBe(503);
  });
});

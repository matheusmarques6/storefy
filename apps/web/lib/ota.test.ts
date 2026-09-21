import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAXIMO_DA_MENSAGEM, canalDaOta, mensagemValida, resumoDaOta, terminou } from '@/lib/ota';
import {
  MOTIVO_NAO_DISPAROU,
  MOTIVO_SEM_CONFIGURACAO,
  TIPO_DO_EVENTO_DE_OTA,
  dispararOta,
} from '@/lib/disparo-da-ota';

const OTA = '11111111-1111-4111-8111-111111111111';
const LOJA = '22222222-2222-4222-8222-222222222222';

let tokenOriginal: string | undefined;
let repoOriginal: string | undefined;

beforeEach(() => {
  tokenOriginal = process.env.GITHUB_DISPATCH_TOKEN;
  repoOriginal = process.env.GITHUB_REPO;
  process.env.GITHUB_DISPATCH_TOKEN = 'token';
  process.env.GITHUB_REPO = 'convertfy/storefy';
});

afterEach(() => {
  if (tokenOriginal === undefined) delete process.env.GITHUB_DISPATCH_TOKEN;
  else process.env.GITHUB_DISPATCH_TOKEN = tokenOriginal;
  if (repoOriginal === undefined) delete process.env.GITHUB_REPO;
  else process.env.GITHUB_REPO = repoOriginal;
});

describe('canalDaOta', () => {
  /*
   * Um canal por loja não é zelo excessivo: o pacote JavaScript carrega as
   * variáveis daquela loja — o id do app, o segredo com que ele assina o que
   * manda —, e um canal compartilhado entregaria o segredo de uma loja ao app
   * de outra.
   */
  it('o canal carrega o id da loja', () => {
    expect(canalDaOta(LOJA)).toBe(`production-${LOJA}`);
  });

  it('lojas diferentes nunca compartilham canal', () => {
    expect(canalDaOta(LOJA)).not.toBe(canalDaOta(OTA));
  });
});

describe('mensagemValida', () => {
  it('aceita uma descrição de verdade', () => {
    expect(mensagemValida('Corrige o carrinho no iPhone')).toBe(true);
  });

  /*
   * A mensagem aparece no painel do Expo ao lado da atualização, e é o que
   * alguém vai ler daqui a seis meses. Vazia não serve.
   */
  it('recusa vazia, curta demais ou só espaço', () => {
    for (const ruim of ['', '   ', 'ok', 'abc', '    a    ']) {
      expect(mensagemValida(ruim), ruim).toBe(false);
    }
  });

  it('recusa acima do limite, porque o Expo corta', () => {
    expect(mensagemValida('x'.repeat(MAXIMO_DA_MENSAGEM))).toBe(true);
    expect(mensagemValida('x'.repeat(MAXIMO_DA_MENSAGEM + 1))).toBe(false);
  });
});

describe('dispararOta', () => {
  it('pede o workflow com o id e a mensagem', async () => {
    let url = '';
    let corpo = '';
    const falso: typeof fetch = (entrada, init) => {
      url = entrada instanceof Request ? entrada.url : entrada.toString();
      corpo = typeof init?.body === 'string' ? init.body : '';
      return Promise.resolve(new Response(null, { status: 204 }));
    };

    expect(await dispararOta(OTA, 'Corrige o carrinho', falso)).toEqual({ ok: true });
    expect(url).toBe('https://api.github.com/repos/convertfy/storefy/dispatches');
    expect(JSON.parse(corpo)).toEqual({
      event_type: TIPO_DO_EVENTO_DE_OTA,
      client_payload: { otaId: OTA, mensagem: 'Corrige o carrinho' },
    });
  });

  /*
   * O `client_payload` fica visível para quem lê as execuções do repositório.
   * Nenhuma credencial pode passar por aqui.
   */
  it('o payload leva só identificador e mensagem', async () => {
    let corpo = '';
    const falso: typeof fetch = (_e, init) => {
      corpo = typeof init?.body === 'string' ? init.body : '';
      return Promise.resolve(new Response(null, { status: 204 }));
    };

    await dispararOta(OTA, 'Corrige o carrinho', falso);
    const enviado = JSON.parse(corpo) as { client_payload: Record<string, unknown> };
    expect(Object.keys(enviado.client_payload).sort()).toEqual(['mensagem', 'otaId']);
  });

  it('corta a mensagem no limite antes de mandar', async () => {
    let corpo = '';
    const falso: typeof fetch = (_e, init) => {
      corpo = typeof init?.body === 'string' ? init.body : '';
      return Promise.resolve(new Response(null, { status: 204 }));
    };

    await dispararOta(OTA, 'x'.repeat(500), falso);
    const enviado = JSON.parse(corpo) as { client_payload: { mensagem: string } };
    expect(enviado.client_payload.mensagem.length).toBe(MAXIMO_DA_MENSAGEM);
  });

  it('sem token ou repositório, recusa sem chamar o GitHub', async () => {
    const naoDeveria: typeof fetch = () => {
      throw new Error('não deveria chamar');
    };

    delete process.env.GITHUB_DISPATCH_TOKEN;
    expect(await dispararOta(OTA, 'Corrige', naoDeveria)).toEqual({
      ok: false,
      motivo: MOTIVO_SEM_CONFIGURACAO,
    });

    process.env.GITHUB_DISPATCH_TOKEN = 'token';
    process.env.GITHUB_REPO = 'sem-barra';
    expect(await dispararOta(OTA, 'Corrige', naoDeveria)).toEqual({
      ok: false,
      motivo: MOTIVO_SEM_CONFIGURACAO,
    });
  });

  it('resposta diferente de 204 e rede fora do ar viram recusa', async () => {
    for (const status of [401, 403, 404, 422, 500]) {
      const falso: typeof fetch = () => Promise.resolve(new Response(null, { status }));
      expect(await dispararOta(OTA, 'Corrige', falso)).toEqual({
        ok: false,
        motivo: MOTIVO_NAO_DISPAROU,
      });
    }

    expect(await dispararOta(OTA, 'Corrige', () => Promise.reject(new Error('x')))).toEqual({
      ok: false,
      motivo: MOTIVO_NAO_DISPAROU,
    });
  });
});

describe('terminou', () => {
  /*
   * Enquanto o total for nulo a matriz nem foi montada. Dar a rodada por
   * encerrada ali mostraria "concluída, 0 de 0" no admin.
   */
  it('sem total, a rodada não terminou', () => {
    expect(terminou({ total: null, concluidas: 0, falhas: 0 })).toBe(false);
    expect(terminou({ total: null, concluidas: 5, falhas: 0 })).toBe(false);
  });

  it('terminou quando todas as lojas responderam', () => {
    expect(terminou({ total: 3, concluidas: 3, falhas: 0 })).toBe(true);
    expect(terminou({ total: 3, concluidas: 1, falhas: 2 })).toBe(true);
    expect(terminou({ total: 3, concluidas: 2, falhas: 0 })).toBe(false);
  });

  /** Um job reexecutado pode contar duas vezes; isso não pode travar a rodada. */
  it('contagem acima do total também fecha', () => {
    expect(terminou({ total: 2, concluidas: 3, falhas: 0 })).toBe(true);
  });
});

describe('resumoDaOta', () => {
  it('fila e preparação têm texto próprio', () => {
    expect(resumoDaOta('queued', { total: null, concluidas: 0, falhas: 0 })).toContain('fila');
    expect(resumoDaOta('running', { total: null, concluidas: 0, falhas: 0 })).toContain(
      'Preparando',
    );
  });

  it('em andamento mostra quantas de quantas', () => {
    expect(resumoDaOta('running', { total: 12, concluidas: 3, falhas: 0 })).toContain(
      '3 de 12 lojas',
    );
  });

  it('uma loja só fica no singular', () => {
    expect(resumoDaOta('finished', { total: 1, concluidas: 1, falhas: 0 })).toContain('1 loja.');
  });

  it('falha aparece no resumo, e não some no sucesso', () => {
    const texto = resumoDaOta('errored', { total: 5, concluidas: 4, falhas: 1 });
    expect(texto).toContain('1 falha');
    expect(texto).not.toContain('falhas');
  });

  it('rodada que não chegou a começar diz isso', () => {
    expect(resumoDaOta('errored', { total: null, concluidas: 0, falhas: 0 })).toContain(
      'não chegou a começar',
    );
  });

  it('nunca devolve texto vazio nem com undefined', () => {
    for (const status of ['queued', 'running', 'finished', 'errored']) {
      for (const total of [null, 0, 1, 7]) {
        const texto = resumoDaOta(status, { total, concluidas: 1, falhas: 0 });
        expect(texto.length, `${status}/${String(total)}`).toBeGreaterThan(5);
        expect(texto).not.toContain('undefined');
        expect(texto).not.toContain('NaN');
      }
    }
  });
});

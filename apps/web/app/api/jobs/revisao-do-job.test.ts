/**
 * O cron que acompanha a revisão da Apple, de ponta a ponta.
 *
 * `lib/revisao.test.ts` prova a leitura da resposta da Apple; aqui se prova a
 * LIGAÇÃO, que é onde mora o risco: que ninguém sem o segredo faz a Storefy
 * gastar a cota das chaves de todos os clientes, que uma instabilidade da
 * Apple NÃO vira erro na tela do lojista, e que uma chave revogada vira — senão
 * o build fica "enviado" para sempre.
 *
 * A Apple e o Supabase são substituídos: nenhum dos dois é alcançável daqui.
 */
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import { criptografar } from '@/lib/cripto';

const CHAVE_DE_CRIPTO = Buffer.alloc(32, 23).toString('base64');
const SEGREDO_DO_CRON = 'segredo-do-cron-da-revisao';
const BUILD = '11111111-1111-4111-8111-111111111111';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const P8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

/** As linhas que `builds_em_revisao` devolve neste teste. */
let emRevisao: Record<string, unknown>[] = [];
/** O que foi chamado no banco. */
let chamadas: { nome: string; args: Record<string, unknown> }[] = [];
/** O que a Apple responde em cada etapa. */
let respostaDoApp: { status: number; corpo: unknown } = {
  status: 200,
  corpo: { data: [{ id: 'app-1' }] },
};
let respostaDaVersao: { status: number; corpo: unknown } = {
  status: 200,
  corpo: { data: [{ attributes: { appStoreState: 'IN_REVIEW', versionString: '1.0' } }] },
};
/** A Apple está fora do ar? */
let appleQuebrada = false;
/** O que `reservar_aviso` responde. */
let reservou = true;
/** Quem `emails_do_build` devolve. */
let destinos: { email: string | null; nome_da_loja: string | null }[] = [];
/** O que a Resend responde, e o que ela recebeu. */
let respostaDaResend = { status: 200 };
let enviados: Record<string, unknown>[] = [];

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave',
  urlDoSite: () => 'https://app.storefy.com.br',
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => ({
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      /*
       * Cada RPC devolve a FORMA que o PostgREST devolveria. Um mock que
       * responde `true` para tudo deixa o código chamar `.map()` num booleano,
       * o erro é engolido pelo try da rota, e o teste passa pelo motivo errado
       * — que foi exatamente o que aconteceu na primeira versão deste arquivo.
       */
      if (nome === 'builds_em_revisao') return Promise.resolve({ data: emRevisao, error: null });
      if (nome === 'emails_do_build') return Promise.resolve({ data: destinos, error: null });
      if (nome === 'reservar_aviso') return Promise.resolve({ data: reservou, error: null });
      if (nome === 'devolver_aviso') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: true, error: null });
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { platform: 'ios' }, error: null }),
        }),
      }),
    }),
  }),
}));

const { GET } = await import('@/app/api/jobs/review-status/route');

let chaveOriginal: string | undefined;
let cronOriginal: string | undefined;
let avisos: MockInstance<typeof console.warn>;
let infos: MockInstance<typeof console.info>;
let erros: MockInstance<typeof console.error>;

/** Uma linha como a que `builds_em_revisao` devolve. */
function linha(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: BUILD,
    bundle_id_ios: 'br.com.loja',
    asc_key_enc: criptografar(P8),
    asc_key_id: 'KEY123',
    asc_issuer_id: 'ISS-456',
    ...extra,
  };
}

beforeEach(() => {
  chaveOriginal = process.env.ENCRYPTION_KEY;
  cronOriginal = process.env.CRON_SECRET;
  process.env.ENCRYPTION_KEY = CHAVE_DE_CRIPTO;
  process.env.CRON_SECRET = SEGREDO_DO_CRON;
  process.env.RESEND_API_KEY = 'chave-da-resend-de-teste';
  process.env.EMAIL_REMETENTE = 'Storefy <avisos@storefy.com.br>';

  chamadas = [];
  appleQuebrada = false;
  reservou = true;
  destinos = [{ email: 'dona@loja.com.br', nome_da_loja: 'Loja da Ana' }];
  respostaDaResend = { status: 200 };
  enviados = [];
  respostaDoApp = { status: 200, corpo: { data: [{ id: 'app-1' }] } };
  respostaDaVersao = {
    status: 200,
    corpo: { data: [{ attributes: { appStoreState: 'IN_REVIEW', versionString: '1.0' } }] },
  };
  emRevisao = [linha()];

  vi.stubGlobal('fetch', (entrada: RequestInfo | URL, init?: RequestInit) => {
    if (appleQuebrada) return Promise.reject(new Error('sem rede'));
    const url = entrada instanceof Request ? entrada.url : entrada.toString();

    if (url.includes('resend.com')) {
      const texto = typeof init?.body === 'string' ? init.body : '{}';
      const corpo: unknown = JSON.parse(texto);
      enviados.push(corpo as Record<string, unknown>);
      return Promise.resolve(new Response('{}', { status: respostaDaResend.status }));
    }

    const r = url.includes('appStoreVersions') ? respostaDaVersao : respostaDoApp;
    return Promise.resolve(new Response(JSON.stringify(r.corpo), { status: r.status }));
  });

  avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  infos = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  erros = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  if (chaveOriginal === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = chaveOriginal;
  if (cronOriginal === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = cronOriginal;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_REMETENTE;
  vi.unstubAllGlobals();
  avisos.mockRestore();
  infos.mockRestore();
  erros.mockRestore();
});

function requisicao(segredo: string | null = SEGREDO_DO_CRON): NextRequest {
  const cabecalhos = new Headers();
  if (segredo !== null) cabecalhos.set('authorization', `Bearer ${segredo}`);
  return new NextRequest('https://app.storefy.com.br/api/jobs/review-status', {
    method: 'GET',
    headers: cabecalhos,
  });
}

/** As chamadas a `gravar_revisao`, que é onde o efeito aparece. */
const gravacoes = (): Record<string, unknown>[] =>
  chamadas.filter((c) => c.nome === 'gravar_revisao').map((c) => c.args);

describe('GET /api/jobs/review-status', () => {
  it('grava a decisão da Apple no build', async () => {
    const resposta = await GET(requisicao());

    expect(resposta.status).toBe(200);
    expect(gravacoes()).toEqual([{ p_id: BUILD, p_status: 'in_review', p_erro: undefined }]);
  });

  it('recusa quando a versão foi aprovada, e limpa o erro anterior', async () => {
    respostaDaVersao = {
      status: 200,
      corpo: { data: [{ attributes: { appStoreState: 'READY_FOR_SALE' } }] },
    };

    await GET(requisicao());
    expect(gravacoes()).toEqual([{ p_id: BUILD, p_status: 'approved', p_erro: undefined }]);
  });

  it('recusa da Apple vira status e instrução', async () => {
    respostaDaVersao = {
      status: 200,
      corpo: { data: [{ attributes: { appStoreState: 'METADATA_REJECTED' } }] },
    };

    await GET(requisicao());
    const [gravada] = gravacoes();
    expect(gravada?.p_status).toBe('rejected');
    expect(String(gravada?.p_erro)).toContain('ficha do app');
  });

  /*
   * Estado de trânsito não mexe na linha. `PROCESSING_FOR_APP_STORE` não é
   * decisão nenhuma, e movê-lo contaria ao lojista algo que ninguém decidiu.
   */
  it('estado de trânsito não grava nada', async () => {
    respostaDaVersao = {
      status: 200,
      corpo: { data: [{ attributes: { appStoreState: 'PROCESSING_FOR_APP_STORE' } }] },
    };

    await GET(requisicao());
    expect(gravacoes()).toEqual([]);
  });

  /*
   * Instabilidade da Apple NÃO pode virar erro na tela: a hora seguinte tenta
   * de novo e resolve sozinha. Gravar aqui assustaria o lojista com um
   * problema que não é dele e que já passou.
   */
  it('Apple instável não escreve nada', async () => {
    for (const status of [429, 500, 503]) {
      chamadas = [];
      respostaDoApp = { status, corpo: {} };
      await GET(requisicao());
      expect(gravacoes()).toEqual([]);
    }

    chamadas = [];
    appleQuebrada = true;
    await GET(requisicao());
    expect(gravacoes()).toEqual([]);
  });

  /*
   * Chave revogada é o contrário: precisa aparecer, senão o build fica
   * "enviado" para sempre e ninguém descobre que a conta caiu. Sem `p_status`,
   * porque isso não é uma decisão da Apple sobre o app.
   */
  it('chave revogada grava a mensagem sem mexer no status', async () => {
    respostaDoApp = { status: 401, corpo: {} };

    await GET(requisicao());
    const [gravada] = gravacoes();
    expect(gravada?.p_status).toBeUndefined();
    expect(String(gravada?.p_erro)).toContain('Reconecte');
  });

  /*
   * A chave de uma loja não abrir não pode parar as outras: o cron cuida de
   * todos os clientes de uma vez.
   */
  it('chave ilegível de uma loja não impede as outras', async () => {
    emRevisao = [
      linha({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', asc_key_enc: 'lixo-que-não-abre' }),
      linha(),
    ];

    await GET(requisicao());
    expect(gravacoes()).toEqual([{ p_id: BUILD, p_status: 'in_review', p_erro: undefined }]);
  });

  it('linha sem bundle ou sem chave é pulada', async () => {
    emRevisao = [
      linha({ bundle_id_ios: null }),
      linha({ asc_key_enc: null }),
      linha({ asc_key_id: null }),
      linha({ asc_issuer_id: null }),
    ];

    await GET(requisicao());
    expect(gravacoes()).toEqual([]);
    expect((await (await GET(requisicao())).json()) as { consultados: number }).toMatchObject({
      consultados: 0,
    });
  });

  /*
   * Sem o segredo, ninguém faz a Storefy gastar a cota das chaves de todos os
   * clientes — nem descobre em que pé está a publicação deles.
   */
  it('sem o segredo do cron, não consulta nada', async () => {
    for (const segredo of [null, 'errado', '']) {
      chamadas = [];
      const resposta = await GET(requisicao(segredo));
      expect(resposta.status).toBe(401);
      expect(chamadas).toEqual([]);
    }
  });

  it('sem CRON_SECRET configurado, responde 503', async () => {
    delete process.env.CRON_SECRET;

    const resposta = await GET(requisicao('qualquer'));
    expect(resposta.status).toBe(503);
    expect(chamadas).toEqual([]);
  });

  it('pede uma quantidade limitada de builds por ciclo', async () => {
    await GET(requisicao());
    const busca = chamadas.find((c) => c.nome === 'builds_em_revisao');
    expect(typeof busca?.args.p_limite).toBe('number');
    expect(Number(busca?.args.p_limite)).toBeLessThanOrEqual(50);
  });
});

/*
 * O aviso por e-mail. A revisão leva de um a três dias e nenhum lojista fica
 * com a tela aberta esperando: sem este e-mail, ele só descobre que o app foi
 * aprovado quando lembrar de voltar aqui.
 */
describe('o aviso da decisão', () => {
  const aprovar = () => {
    respostaDaVersao = {
      status: 200,
      corpo: { data: [{ attributes: { appStoreState: 'READY_FOR_SALE' } }] },
    };
  };

  it('aprovação manda e-mail para quem administra a loja', async () => {
    aprovar();
    destinos = [
      { email: 'dona@loja.com.br', nome_da_loja: 'Loja da Ana' },
      { email: 'socio@loja.com.br', nome_da_loja: 'Loja da Ana' },
    ];

    const resposta = await GET(requisicao());

    expect(await resposta.json()).toMatchObject({ avisados: 1 });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({
      to: ['dona@loja.com.br', 'socio@loja.com.br'],
      from: 'Storefy <avisos@storefy.com.br>',
    });
    expect(String(enviados[0]?.subject)).toContain('aprovado');
    expect(String(enviados[0]?.subject)).toContain('Loja da Ana');
  });

  it('recusa manda o motivo traduzido no corpo', async () => {
    respostaDaVersao = {
      status: 200,
      corpo: { data: [{ attributes: { appStoreState: 'METADATA_REJECTED' } }] },
    };

    await GET(requisicao());

    expect(String(enviados[0]?.subject)).toContain('não passou');
    expect(String(enviados[0]?.text)).toContain('ficha do app');
    expect(String(enviados[0]?.html)).toContain('ficha do app');
  });

  /*
   * `in_review` não vira e-mail. Mandar os três estados transformaria três
   * dias de espera em três e-mails, e o terceiro seria lido com a mesma
   * atenção do segundo: nenhuma.
   */
  it('em revisão não manda e-mail nenhum', async () => {
    await GET(requisicao());
    expect(enviados).toEqual([]);
  });

  /*
   * A reserva é atômica e vem antes do envio: o cron roda de hora em hora, e
   * uma execução que demore mais do que isso encontra a seguinte já rodando.
   * Sem a reserva, as duas mandariam o mesmo "seu app foi aprovado".
   */
  it('sem conseguir a reserva, não manda nada', async () => {
    aprovar();
    reservou = false;

    const resposta = await GET(requisicao());

    expect(enviados).toEqual([]);
    expect(await resposta.json()).toMatchObject({ avisados: 0 });
  });

  it('a reserva é pedida antes do envio, e para a decisão certa', async () => {
    aprovar();
    await GET(requisicao());

    const reserva = chamadas.find((c) => c.nome === 'reservar_aviso');
    expect(reserva?.args).toEqual({ p_id: BUILD, p_status: 'approved' });
  });

  it('organização sem e-mail ativo não vira envio nem erro', async () => {
    aprovar();
    destinos = [];

    const resposta = await GET(requisicao());
    expect(resposta.status).toBe(200);
    expect(enviados).toEqual([]);
  });

  /*
   * Falha passageira do e-mail DEVOLVE a reserva. Sem isso, uma queda de dez
   * minutos da Resend faria o lojista nunca saber que o app foi aprovado — a
   * marca no banco ficaria dizendo que já avisamos.
   */
  it('queda da Resend devolve a reserva para a próxima hora tentar', async () => {
    aprovar();
    respostaDaResend = { status: 503 };

    await GET(requisicao());

    expect(chamadas.some((c) => c.nome === 'devolver_aviso')).toBe(true);
  });

  /*
   * Falha permanente NÃO devolve: chave errada e domínio não verificado não
   * melhoram sozinhos, e retentar de hora em hora só encheria o log.
   */
  it('recusa permanente da Resend não fica retentando', async () => {
    aprovar();
    respostaDaResend = { status: 422 };

    await GET(requisicao());

    expect(chamadas.some((c) => c.nome === 'devolver_aviso')).toBe(false);
  });

  /*
   * Sem chave da Resend o aviso conta como passageiro: quando ela for
   * configurada, o próximo ciclo manda. Descartar aqui perderia para sempre um
   * aviso por causa de uma variável que ainda vai ser preenchida.
   */
  it('sem RESEND_API_KEY, a reserva volta e o build não fica sem aviso', async () => {
    aprovar();
    delete process.env.RESEND_API_KEY;

    await GET(requisicao());

    expect(enviados).toEqual([]);
    expect(chamadas.some((c) => c.nome === 'devolver_aviso')).toBe(true);
  });
});

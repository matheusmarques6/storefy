/**
 * Os dois jobs do cron, de ponta a ponta.
 *
 * O que se prova aqui é a LIGAÇÃO, que é onde mora o risco: que ninguém sem o
 * segredo dispara push para a base de todos os clientes, que uma chave que não
 * abre vira falha marcada em vez de repetição infinita, e que uma
 * instabilidade de rede NÃO marca falha — porque marcar jogaria fora uma
 * campanha que ia sair no minuto seguinte.
 *
 * O Supabase e a OneSignal são substituídos: nenhum dos dois é alcançável
 * daqui, e o que está sendo testado é a rota.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import { criptografar } from '@/lib/cripto';

const CHAVE = Buffer.alloc(32, 13).toString('base64');
const SEGREDO_DO_CRON = 'segredo-do-cron';
const CAMPANHA = '11111111-1111-4111-8111-111111111111';
const ENVIO = '22222222-2222-4222-8222-222222222222';

/** O que cada RPC devolve neste teste, e o que foi chamado. */
let respostas: Record<string, unknown> = {};
let chamadas: { nome: string; args: Record<string, unknown> }[] = [];
/** O que cada RPC de lista devolve quando o teste não diz outra coisa. */
const RETORNO_PADRAO: Record<string, unknown> = {
  reservar_campanhas: [],
  reservar_envios_de_automacao: [],
  campanhas_para_estatistica: [],
};

/** A resposta da OneSignal. */
let respostaDaOneSignal: { status: number; corpo: unknown } = {
  status: 200,
  corpo: { id: 'notificacao-1', recipients: 42 },
};
let oneSignalQuebrada = false;
/** O banco recusa toda chamada, como numa queda de conexão. */
let bancoQuebrado = false;

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave',
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => ({
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      if (bancoQuebrado) {
        return Promise.resolve({ data: null, error: { message: 'conexão caiu' } });
      }
      /*
       * Lista vazia, e não `null`: um RPC `returns table` volta do PostgREST
       * como array, sempre. Devolver `null` aqui faria o teste exigir do
       * código uma defesa contra algo que não acontece — e esconderia a
       * ausência dela no caso que acontece de verdade.
       */
      return Promise.resolve({
        data: respostas[nome] ?? RETORNO_PADRAO[nome] ?? null,
        error: null,
      });
    },
  }),
}));

const { GET: despachar } = await import('@/app/api/jobs/dispatch-push/route');
const { GET: estatisticas } = await import('@/app/api/jobs/push-stats/route');

let chaveOriginal: string | undefined;
let cronOriginal: string | undefined;
let logs: MockInstance<typeof console.info>[];

beforeEach(() => {
  chaveOriginal = process.env.ENCRYPTION_KEY;
  cronOriginal = process.env.CRON_SECRET;
  process.env.ENCRYPTION_KEY = CHAVE;
  process.env.CRON_SECRET = SEGREDO_DO_CRON;

  chamadas = [];
  respostas = {};
  oneSignalQuebrada = false;
  bancoQuebrado = false;
  respostaDaOneSignal = { status: 200, corpo: { id: 'notificacao-1', recipients: 42 } };

  vi.stubGlobal('fetch', () => {
    if (oneSignalQuebrada) return Promise.reject(new Error('sem rede'));
    return Promise.resolve(
      new Response(JSON.stringify(respostaDaOneSignal.corpo), {
        status: respostaDaOneSignal.status,
      }),
    );
  });

  logs = [
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  if (chaveOriginal === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = chaveOriginal;
  if (cronOriginal === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = cronOriginal;
  for (const log of logs) log.mockRestore();
  vi.unstubAllGlobals();
});

function requisicao(caminho: string, autorizacao: string | null): NextRequest {
  const cabecalhos = new Headers();
  if (autorizacao !== null) cabecalhos.set('authorization', autorizacao);
  return new NextRequest(`https://app.storefy.com.br${caminho}`, { headers: cabecalhos });
}

const comSegredo = (caminho: string) => requisicao(caminho, `Bearer ${SEGREDO_DO_CRON}`);

function campanhaReservada(extra: Record<string, unknown> = {}) {
  return [
    {
      id: CAMPANHA,
      app_id: 'app-1',
      title: 'Promoção',
      body: 'Até 40% OFF',
      deep_link: '/promocoes',
      segment: {},
      onesignal_app_id: 'os-1',
      onesignal_api_key_enc: criptografar('chave-rest'),
      ...extra,
    },
  ];
}

const chamou = (nome: string) => chamadas.filter((c) => c.nome === nome);

describe('GET /api/jobs/dispatch-push', () => {
  /*
   * A asserção que justifica o segredo existir: sem ela, qualquer um na
   * internet dispara o push de todos os clientes da plataforma.
   */
  it('recusa quem não tem o segredo do cron, e nem toca no banco', async () => {
    for (const cabecalho of [null, 'Bearer errado', 'segredo-do-cron']) {
      chamadas = [];
      const resposta = await despachar(requisicao('/api/jobs/dispatch-push', cabecalho));
      expect(resposta.status).toBe(401);
      expect(chamadas).toHaveLength(0);
    }
  });

  it('recusa quando não há CRON_SECRET configurado', async () => {
    delete process.env.CRON_SECRET;
    const resposta = await despachar(comSegredo('/api/jobs/dispatch-push'));
    expect(resposta.status).toBe(503);
    expect(chamadas).toHaveLength(0);
  });

  it('destrava o que ficou preso antes de começar a enviar', async () => {
    respostas = { devolver_campanhas_presas: 2, devolver_envios_presos: 1 };
    const resposta = await despachar(comSegredo('/api/jobs/dispatch-push'));

    expect(resposta.status).toBe(200);
    await expect(resposta.json()).resolves.toMatchObject({ destravados: 3 });
  });

  it('envia a campanha e anota o id da notificação', async () => {
    respostas = { reservar_campanhas: campanhaReservada() };
    const resposta = await despachar(comSegredo('/api/jobs/dispatch-push'));

    await expect(resposta.json()).resolves.toMatchObject({ enviados: 1, falhas: 0 });
    expect(chamou('concluir_campanha')[0]?.args).toEqual({
      p_id: CAMPANHA,
      p_notification_id: 'notificacao-1',
      p_stats: { enviados: 42 },
    });
  });

  it('não marca nada como enviado quando a OneSignal recusa', async () => {
    respostaDaOneSignal = { status: 400, corpo: { errors: ['Invalid app_id format'] } };
    respostas = { reservar_campanhas: campanhaReservada() };

    const resposta = await despachar(comSegredo('/api/jobs/dispatch-push'));
    await expect(resposta.json()).resolves.toMatchObject({ enviados: 0, falhas: 1 });
    expect(chamou('concluir_campanha')).toHaveLength(0);
    expect(chamou('falhar_campanha')[0]?.args.p_motivo).toBe('Invalid app_id format');
  });

  /*
   * O ponto mais delicado do job. Rede caindo NÃO pode marcar falha: a
   * campanha voltaria como "falhou" para o lojista e nunca sairia, quando
   * bastava o minuto seguinte. Ela fica reservada, e `devolver_campanhas_presas`
   * a recoloca na fila em 15 minutos.
   */
  it('falha passageira não marca falha: a campanha volta à fila sozinha', async () => {
    oneSignalQuebrada = true;
    respostas = { reservar_campanhas: campanhaReservada() };

    const resposta = await despachar(comSegredo('/api/jobs/dispatch-push'));
    await expect(resposta.json()).resolves.toMatchObject({
      processados: 1,
      enviados: 0,
      falhas: 0,
    });
    expect(chamou('falhar_campanha')).toHaveLength(0);
    expect(chamou('concluir_campanha')).toHaveLength(0);
  });

  it('loja sem OneSignal vira falha com motivo em pt-BR, e não tentativa', async () => {
    respostas = { reservar_campanhas: campanhaReservada({ onesignal_app_id: null }) };

    const resposta = await despachar(comSegredo('/api/jobs/dispatch-push'));
    await expect(resposta.json()).resolves.toMatchObject({ falhas: 1 });

    const motivo = chamou('falhar_campanha')[0]?.args.p_motivo;
    expect(String(motivo)).toContain('notificações');
  });

  it('chave que não abre vira falha marcada, não repetição infinita', async () => {
    respostas = {
      reservar_campanhas: campanhaReservada({ onesignal_api_key_enc: 'v1.lixo.lixo.lixo' }),
    };

    const resposta = await despachar(comSegredo('/api/jobs/dispatch-push'));
    await expect(resposta.json()).resolves.toMatchObject({ falhas: 1 });
    expect(String(chamou('falhar_campanha')[0]?.args.p_motivo)).toContain('chave');
  });

  it('envio de automação vai só para o aparelho que disparou o gatilho', async () => {
    respostas = {
      reservar_envios_de_automacao: [
        {
          id: ENVIO,
          automation_id: 'auto-1',
          app_id: 'app-1',
          subscription_id: 'sub-do-cliente',
          title: 'Esqueceu algo?',
          body: 'Seu carrinho continua aqui.',
          deep_link: '/cart',
          onesignal_app_id: 'os-1',
          onesignal_api_key_enc: criptografar('chave-rest'),
        },
      ],
    };

    const corpos: unknown[] = [];
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      corpos.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));
      return Promise.resolve(new Response(JSON.stringify({ id: 'n-2', recipients: 1 })));
    });

    const resposta = await despachar(comSegredo('/api/jobs/dispatch-push'));
    await expect(resposta.json()).resolves.toMatchObject({ enviados: 1 });

    expect(corpos[0]).toMatchObject({
      include_subscription_ids: ['sub-do-cliente'],
      data: { deep_link: '/cart' },
    });
    // E não para todo mundo, que seria o desastre silencioso desta rota.
    expect(corpos[0]).not.toHaveProperty('included_segments');
    expect(chamou('concluir_envio')[0]?.args).toEqual({ p_id: ENVIO });
  });

  /*
   * Uma exceção que escapasse viraria a página de erro do Next, em HTML — e o
   * cron da Vercel registraria "sucesso" para uma execução que não enviou
   * nada.
   */
  it('não devolve HTML quando o banco falha', async () => {
    bancoQuebrado = true;

    const resposta = await despachar(comSegredo('/api/jobs/dispatch-push'));
    expect(resposta.status).toBe(500);
    expect(resposta.headers.get('Content-Type')).toContain('application/json');
    await expect(resposta.json()).resolves.toMatchObject({ erro: 'falhou' });
  });
});

describe('GET /api/jobs/push-stats', () => {
  /*
   * Função, e não constante: `criptografar` lê a ENCRYPTION_KEY, e uma
   * constante de módulo rodaria antes do `beforeEach` que a define.
   */
  const campanhaEnviada = () => ({
    id: CAMPANHA,
    app_id: 'app-1',
    onesignal_notification_id: 'notificacao-1',
    onesignal_app_id: 'os-1',
    onesignal_api_key_enc: criptografar('chave-rest'),
  });

  it('recusa quem não tem o segredo do cron', async () => {
    const resposta = await estatisticas(requisicao('/api/jobs/push-stats', null));
    expect(resposta.status).toBe(401);
    expect(chamadas).toHaveLength(0);
  });

  it('grava os números que a OneSignal devolveu', async () => {
    respostas = { campanhas_para_estatistica: [campanhaEnviada()] };
    respostaDaOneSignal = {
      status: 200,
      corpo: { successful: 950, converted: 190, failed: 50 },
    };

    const resposta = await estatisticas(comSegredo('/api/jobs/push-stats'));
    await expect(resposta.json()).resolves.toEqual({ consultadas: 1, atualizadas: 1 });
    expect(chamou('gravar_estatistica')[0]?.args.p_stats).toEqual({
      enviados: 950,
      entregues: 950,
      abertos: 190,
      falhas: 50,
    });
  });

  /*
   * O que a OneSignal não informou NÃO é gravado como zero. Um zero aqui vira
   * "a campanha não abriu" na leitura do lojista — e é uma afirmação sobre um
   * número que ninguém mediu (regra 1 do CLAUDE.md).
   */
  it('não grava zero para o que a OneSignal não informou', async () => {
    respostas = { campanhas_para_estatistica: [campanhaEnviada()] };
    respostaDaOneSignal = { status: 200, corpo: { successful: 900 } };

    await estatisticas(comSegredo('/api/jobs/push-stats'));
    expect(chamou('gravar_estatistica')[0]?.args.p_stats).toEqual({
      enviados: 900,
      entregues: 900,
    });
  });

  it('não grava nada quando a consulta falha', async () => {
    respostas = { campanhas_para_estatistica: [campanhaEnviada()] };
    oneSignalQuebrada = true;

    const resposta = await estatisticas(comSegredo('/api/jobs/push-stats'));
    await expect(resposta.json()).resolves.toEqual({ consultadas: 1, atualizadas: 0 });
    expect(chamou('gravar_estatistica')).toHaveLength(0);
  });

  it('uma chave ilegível não impede as outras campanhas', async () => {
    respostas = {
      campanhas_para_estatistica: [
        { ...campanhaEnviada(), id: 'aaa', onesignal_api_key_enc: 'v1.lixo.lixo.lixo' },
        campanhaEnviada(),
      ],
    };
    respostaDaOneSignal = { status: 200, corpo: { successful: 10 } };

    const resposta = await estatisticas(comSegredo('/api/jobs/push-stats'));
    await expect(resposta.json()).resolves.toEqual({ consultadas: 2, atualizadas: 1 });
  });
});

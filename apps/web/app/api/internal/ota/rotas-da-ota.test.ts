/**
 * As duas rotas internas da correção OTA, de ponta a ponta.
 *
 * `lib/ota.test.ts` prova as decisões; aqui se prova a LIGAÇÃO, e o que está
 * em jogo é um vazamento entre clientes: a lista de lojas vira nome de job na
 * interface do GitHub, então ela não pode carregar segredo, e os dados de uma
 * loja não podem sair para o job de outra.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import { criptografar } from '@/lib/cripto';

const CHAVE = Buffer.alloc(32, 31).toString('base64');
const SEGREDO = 'segredo-do-build';
const OTA = '11111111-1111-4111-8111-111111111111';
const LOJA_A = '22222222-2222-4222-8222-222222222222';
const LOJA_B = '33333333-3333-4333-8333-333333333333';

/** A rodada existe e está aberta? */
let rodada: { id: string; status: string } | null = null;
/** O que cada RPC devolve. */
let lojas: { store_id: string | null; app_id: string | null; nome: string | null }[] = [];
let dadosDaLoja: Record<string, unknown>[] = [];
/** O que foi chamado no banco. */
let chamadas: { nome: string; args: unknown }[] = [];
/** O que foi gravado em `ota_updates`. */
let gravado: Record<string, unknown> | null = null;
/** A leitura de progresso que a rota de status faz. */
let progresso: Record<string, unknown> | null = null;

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave',
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => ({
    rpc: (nome: string, args: unknown) => {
      chamadas.push({ nome, args });
      if (nome === 'lojas_para_ota') return Promise.resolve({ data: lojas, error: null });
      if (nome === 'dados_da_ota') return Promise.resolve({ data: dadosDaLoja, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from: () => {
      const encadeavel: Record<string, unknown> = {};
      /*
       * O mock APLICA o filtro `.in('status', …)`. Sem isso, tirar a trava da
       * rota não mudaria nada no teste — e a rota continuaria servindo o
       * segredo do app de um cliente para um `otaId` de uma rodada encerrada.
       */
      let statusAceitos: readonly string[] | null = null;

      Object.assign(encadeavel, {
        select: () => encadeavel,
        update: (valores: Record<string, unknown>) => {
          gravado = valores;
          return encadeavel;
        },
        eq: () => encadeavel,
        in: (_coluna: string, valores: readonly string[]) => {
          statusAceitos = valores;
          return encadeavel;
        },
        maybeSingle: () => {
          const linha = progresso ?? rodada;
          const status = (linha as { status?: string } | null)?.status;
          const passa =
            linha !== null &&
            (statusAceitos === null || (status !== undefined && statusAceitos.includes(status)));
          return Promise.resolve({ data: passa ? linha : null, error: null });
        },
        then: (aceitar: (v: unknown) => unknown) => aceitar({ data: null, error: null }),
      });
      return encadeavel;
    },
  }),
}));

const { POST: postarOta } = await import('@/app/api/internal/ota/route');
const { POST: postarStatus } = await import('@/app/api/internal/ota/status/route');

let chaveOriginal: string | undefined;
let segredoOriginal: string | undefined;
let avisos: MockInstance<typeof console.warn>;
let erros: MockInstance<typeof console.error>;

beforeEach(() => {
  chaveOriginal = process.env.ENCRYPTION_KEY;
  segredoOriginal = process.env.BUILD_API_SECRET;
  process.env.ENCRYPTION_KEY = CHAVE;
  process.env.BUILD_API_SECRET = SEGREDO;

  chamadas = [];
  gravado = null;
  progresso = null;
  rodada = { id: OTA, status: 'queued' };
  lojas = [
    { store_id: LOJA_A, app_id: 'app-a', nome: 'Loja A' },
    { store_id: LOJA_B, app_id: 'app-b', nome: 'Loja B' },
  ];
  dadosDaLoja = [
    {
      app_id: 'app-a',
      store_id: LOJA_A,
      nome_do_app: 'Loja A',
      bundle_id_ios: 'br.com.a',
      package_android: 'br.com.a',
      expo_project_id: 'proj-a',
      onesignal_app_id: 'os-a',
      device_secret_enc: criptografar('segredo-da-loja-a'),
    },
  ];

  avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  erros = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  if (chaveOriginal === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = chaveOriginal;
  if (segredoOriginal === undefined) delete process.env.BUILD_API_SECRET;
  else process.env.BUILD_API_SECRET = segredoOriginal;
  avisos.mockRestore();
  erros.mockRestore();
});

function requisicao(caminho: string, corpo: unknown, segredo = SEGREDO): NextRequest {
  return new NextRequest(`https://app.storefy.com.br${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${segredo}` },
    body: JSON.stringify(corpo),
  });
}

describe('POST /api/internal/ota', () => {
  /*
   * A resposta desta etapa vira NOME DE JOB na interface do GitHub, visível
   * para quem tem leitura no repositório. Se a lista trouxesse os segredos, o
   * segredo de cada loja apareceria no log de montagem da matriz.
   */
  it('a lista leva só o id e o canal de cada loja', async () => {
    const resposta = await postarOta(
      requisicao('/api/internal/ota', { etapa: 'lista', otaId: OTA }),
    );
    expect(resposta.status).toBe(200);

    const dados = (await resposta.json()) as { lojas: Record<string, unknown>[] };
    expect(dados.lojas).toEqual([
      { storeId: LOJA_A, canal: `production-${LOJA_A}` },
      { storeId: LOJA_B, canal: `production-${LOJA_B}` },
    ]);

    const texto = JSON.stringify(dados);
    for (const segredo of ['segredo-da-loja', 'device_secret', 'os-a', 'proj-a']) {
      expect(texto, segredo).not.toContain(segredo);
    }
  });

  /** É o total que o admin usa para mostrar "3 de 12" enquanto a matriz roda. */
  it('a lista grava o total da rodada', async () => {
    await postarOta(requisicao('/api/internal/ota', { etapa: 'lista', otaId: OTA }));
    expect(gravado).toMatchObject({ total: 2, status: 'running' });
  });

  it('a etapa da loja devolve as variáveis do pacote dela', async () => {
    const resposta = await postarOta(
      requisicao('/api/internal/ota', { etapa: 'loja', otaId: OTA, storeId: LOJA_A }),
    );
    expect(resposta.status).toBe(200);

    const dados = (await resposta.json()) as Record<string, unknown>;
    expect(dados).toMatchObject({
      storeId: LOJA_A,
      expoProjectId: 'proj-a',
      oneSignalAppId: 'os-a',
      deviceSecret: 'segredo-da-loja-a',
      canal: `production-${LOJA_A}`,
    });
  });

  /*
   * Um `otaId` antigo, que apareceu num log de execução, não pode continuar
   * servindo para buscar o segredo do app de um cliente.
   */
  it('rodada inexistente não devolve nada', async () => {
    rodada = null;

    for (const corpo of [
      { etapa: 'lista', otaId: OTA },
      { etapa: 'loja', otaId: OTA, storeId: LOJA_A },
    ]) {
      const resposta = await postarOta(requisicao('/api/internal/ota', corpo));
      expect(resposta.status).toBe(404);
    }
  });

  /*
   * A rodada JÁ TERMINOU, mas a linha continua no banco. Sem a trava de status
   * na consulta, um `otaId` que apareceu num log de execução continuaria
   * servindo para baixar o segredo do app de um cliente — para sempre.
   */
  it('rodada já encerrada não serve mais segredo nenhum', async () => {
    for (const status of ['finished', 'errored']) {
      rodada = { id: OTA, status };

      for (const corpo of [
        { etapa: 'lista', otaId: OTA },
        { etapa: 'loja', otaId: OTA, storeId: LOJA_A },
      ]) {
        const resposta = await postarOta(requisicao('/api/internal/ota', corpo));
        expect(resposta.status, `${status} / ${corpo.etapa}`).toBe(404);
      }
    }
  });

  it('loja sem projeto no Expo vira 404', async () => {
    dadosDaLoja = [];
    const resposta = await postarOta(
      requisicao('/api/internal/ota', { etapa: 'loja', otaId: OTA, storeId: LOJA_A }),
    );
    expect(resposta.status).toBe(404);
  });

  it('etapa inventada vira 400', async () => {
    const resposta = await postarOta(
      requisicao('/api/internal/ota', { etapa: 'tudo', otaId: OTA }),
    );
    expect(resposta.status).toBe(400);
  });

  it('sem o segredo certo, nada sai', async () => {
    const resposta = await postarOta(
      requisicao('/api/internal/ota', { etapa: 'lista', otaId: OTA }, 'errado'),
    );
    expect(resposta.status).toBe(401);
    expect(chamadas).toEqual([]);
  });
});

describe('POST /api/internal/ota/status', () => {
  /*
   * A soma é no banco, não aqui: os jobs da matriz correm em paralelo, e dois
   * terminando ao mesmo tempo escreveriam por cima um do outro se o contador
   * fosse lido e gravado em duas idas.
   */
  it('conta a loja no banco, de forma atômica', async () => {
    progresso = { total: 5, concluidas: 1, falhas: 0, status: 'running' };

    await postarStatus(requisicao('/api/internal/ota/status', { otaId: OTA, ok: true }));

    expect(chamadas).toContainEqual({
      nome: 'contar_ota',
      args: { p_id: OTA, p_ok: true },
    });
  });

  it('a rodada fecha quando a última loja responde', async () => {
    progresso = { total: 3, concluidas: 3, falhas: 0, status: 'running' };

    await postarStatus(requisicao('/api/internal/ota/status', { otaId: OTA, ok: true }));
    expect(gravado).toMatchObject({ status: 'finished' });
  });

  /** Uma loja que falhou marca a rodada inteira: alguém precisa olhar. */
  it('rodada com falha fecha como erro', async () => {
    progresso = { total: 3, concluidas: 2, falhas: 1, status: 'running' };

    await postarStatus(requisicao('/api/internal/ota/status', { otaId: OTA, ok: false }));
    expect(gravado).toMatchObject({ status: 'errored' });
  });

  it('no meio do caminho, a rodada não fecha', async () => {
    progresso = { total: 5, concluidas: 2, falhas: 0, status: 'running' };

    await postarStatus(requisicao('/api/internal/ota/status', { otaId: OTA, ok: true }));
    expect(gravado).toBeNull();
  });

  /*
   * A preparação pode falhar antes de a matriz existir. Sem este caminho a
   * rodada ficaria "na fila" para sempre, e a trava de "já existe uma em
   * andamento" impediria qualquer correção dali em diante.
   */
  it('falha da preparação fecha a rodada com o motivo', async () => {
    progresso = { total: null, concluidas: 0, falhas: 0, status: 'queued' };

    await postarStatus(
      requisicao('/api/internal/ota/status', { otaId: OTA, erro: 'Nenhuma loja no Expo.' }),
    );
    expect(gravado).toMatchObject({ status: 'errored', error: 'Nenhuma loja no Expo.' });
  });

  it('rodada inexistente vira 404', async () => {
    progresso = null;
    rodada = null;

    const resposta = await postarStatus(
      requisicao('/api/internal/ota/status', { otaId: OTA, ok: true }),
    );
    expect(resposta.status).toBe(404);
  });

  it('sem o segredo certo, nada é contado', async () => {
    const resposta = await postarStatus(
      requisicao('/api/internal/ota/status', { otaId: OTA, ok: true }, 'errado'),
    );
    expect(resposta.status).toBe(401);
    expect(chamadas).toEqual([]);
  });
});

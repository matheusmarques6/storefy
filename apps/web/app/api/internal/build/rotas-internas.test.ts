/**
 * As duas rotas internas do build, exercitadas de ponta a ponta.
 *
 * `lib/build-interno.test.ts` e `lib/submissao.test.ts` provam as decisões;
 * aqui se prova a LIGAÇÃO — que a etapa muda o que a rota devolve, que a trava
 * de transição chega ao `update`, que a falha do envio é traduzida no servidor
 * e que nenhuma credencial escapa para a etapa errada.
 *
 * O Supabase é substituído porque a rede para `*.supabase.co` não existe neste
 * ambiente; o que está sendo testado aqui são as rotas, não o driver.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import { criptografar } from '@/lib/cripto';

const CHAVE = Buffer.alloc(32, 7).toString('base64');
const SEGREDO = 'segredo-do-build-de-teste';
const BUILD = '11111111-1111-4111-8111-111111111111';
const APP = '22222222-2222-4222-8222-222222222222';
const LOJA = '33333333-3333-4333-8333-333333333333';
const ORG = '44444444-4444-4444-8444-444444444444';

/** O estado do banco falso, remontado a cada teste. */
let statusDoBuild = 'finished';
/** O que a rota de status mandou gravar em `builds`. */
let gravadoNoBuild: Record<string, unknown> | null = null;
/** O que a rota de status mandou gravar em `apps`. */
let gravadoNoApp: Record<string, unknown> | null = null;
/** Os filtros aplicados no update de `builds`. */
let filtros: { coluna: string; valor: unknown }[] = [];
/** Os filtros aplicados no update de `apps`, com o nome do método. */
let filtrosDoApp: { metodo: string; coluna: string; valor: unknown }[] = [];

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave-de-teste',
}));

vi.mock('@/lib/assets-da-loja', () => ({
  urlAssinada: () => Promise.resolve('https://exemplo/asset.png'),
}));

function linhaDoBuild(): Record<string, unknown> {
  return {
    id: BUILD,
    app_id: APP,
    platform: 'android',
    profile: 'production',
    status: statusDoBuild,
    config_version: 3,
    eas_build_id: 'eas-123',
  };
}

const LINHA_DO_APP = {
  id: APP,
  store_id: LOJA,
  display_name: 'Loja de Teste',
  bundle_id_ios: 'br.com.loja',
  package_android: 'br.com.loja',
  expo_project_id: null,
  onesignal_app_id: 'os-1',
  device_secret_enc: null as string | null,
  icon_path: `${LOJA}/icon.png`,
  splash_path: null,
};

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => ({
    from: (tabela: string) => ({
      select: () => leitura(tabela),
      update: (valores: Record<string, unknown>) => {
        if (tabela === 'builds') gravadoNoBuild = valores;
        else gravadoNoApp = valores;

        const encadeavel: Record<string, unknown> = {};
        const registrar = (metodo: string) => (coluna: string, valor: unknown) => {
          if (tabela === 'builds') filtros.push({ coluna, valor });
          else filtrosDoApp.push({ metodo, coluna, valor });
          return encadeavel;
        };
        Object.assign(encadeavel, {
          eq: registrar('eq'),
          in: registrar('in'),
          is: registrar('is'),
          select: () => Promise.resolve({ data: [{ app_id: APP }], error: null }),
          then: (aceitar: (v: unknown) => unknown) => aceitar({ data: null, error: null }),
        });
        return encadeavel;
      },
    }),
  }),
}));

/** Encadeamento de leitura do supabase-js, no mínimo que as rotas usam. */
function leitura(tabela: string): Record<string, unknown> {
  const dados =
    tabela === 'builds'
      ? linhaDoBuild()
      : tabela === 'apps'
        ? { ...LINHA_DO_APP }
        : tabela === 'stores'
          ? { id: LOJA, org_id: ORG, name: 'Loja de Teste' }
          : tabela === 'app_configs'
            ? { config: { theme: { background: '#112233' } }, version: 3 }
            : null;

  const contas = [
    {
      platform: 'apple',
      apple_team_id: 'TEAM1',
      asc_key_id: 'KEY1',
      asc_issuer_id: 'ISS1',
      asc_key_enc: criptografar('-----BEGIN PRIVATE KEY-----\nasc\n-----END PRIVATE KEY-----'),
      google_service_account_enc: null,
    },
    {
      platform: 'google',
      apple_team_id: null,
      asc_key_id: null,
      asc_issuer_id: null,
      asc_key_enc: null,
      google_service_account_enc: criptografar('{"type":"service_account"}'),
    },
  ];

  const encadeavel: Record<string, unknown> = {};
  Object.assign(encadeavel, {
    eq: () => encadeavel,
    maybeSingle: () => Promise.resolve({ data: dados, error: null }),
    // `developer_accounts` é lido como lista, sem maybeSingle.
    then: (aceitar: (v: unknown) => unknown) =>
      aceitar({ data: tabela === 'developer_accounts' ? contas : dados, error: null }),
  });
  return encadeavel;
}

const { POST: postarBuild } = await import('@/app/api/internal/build/route');
const { POST: postarStatus } = await import('@/app/api/internal/build/status/route');

let chaveOriginal: string | undefined;
let segredoOriginal: string | undefined;
let avisos: MockInstance<typeof console.warn>;
let erros: MockInstance<typeof console.error>;

beforeEach(() => {
  chaveOriginal = process.env.ENCRYPTION_KEY;
  segredoOriginal = process.env.BUILD_API_SECRET;
  process.env.ENCRYPTION_KEY = CHAVE;
  process.env.BUILD_API_SECRET = SEGREDO;
  statusDoBuild = 'finished';
  gravadoNoBuild = null;
  gravadoNoApp = null;
  filtros = [];
  filtrosDoApp = [];
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

describe('POST /api/internal/build — etapa de envio', () => {
  /*
   * O envio precisa da credencial da loja de aplicativos e de NADA MAIS. Dar a
   * ele a resposta da geração espalharia o segredo do app e a config inteira
   * por um passo que não usa nenhum dos dois.
   */
  it('a etapa submit devolve só o que o eas submit precisa', async () => {
    const resposta = await postarBuild(
      requisicao('/api/internal/build', { buildId: BUILD, etapa: 'submit' }),
    );
    expect(resposta.status).toBe(200);

    const dados = (await resposta.json()) as Record<string, unknown>;
    expect(Object.keys(dados).sort()).toEqual([
      'buildId',
      'bundleIdIos',
      'credenciais',
      'easBuildId',
      'expoProjectId',
      'nomeDoApp',
      'packageAndroid',
      'platform',
      'profile',
      'storeId',
    ]);
    expect(dados).not.toHaveProperty('config');
    expect(dados).not.toHaveProperty('deviceSecret');
    expect(dados).not.toHaveProperty('urlDoIcone');
  });

  it('a etapa submit abre as credenciais da organização', async () => {
    const resposta = await postarBuild(
      requisicao('/api/internal/build', { buildId: BUILD, etapa: 'submit' }),
    );
    const dados = (await resposta.json()) as { credenciais: Record<string, string | null> };

    expect(dados.credenciais.ascKeyId).toBe('KEY1');
    expect(dados.credenciais.appleTeamId).toBe('TEAM1');
    expect(dados.credenciais.ascKey).toContain('BEGIN PRIVATE KEY');
    expect(dados.credenciais.googleServiceAccount).toBe('{"type":"service_account"}');
  });

  /*
   * As janelas das duas etapas não se encostam. Um `buildId` viaja no
   * `client_payload`, visível para quem lê as execuções do repositório: se as
   * janelas se sobrepusessem, um id que apareceu num log serviria por mais
   * tempo do que o necessário.
   */
  it('a etapa submit não serve um build que ainda está gerando', async () => {
    statusDoBuild = 'building';
    const resposta = await postarBuild(
      requisicao('/api/internal/build', { buildId: BUILD, etapa: 'submit' }),
    );
    expect(resposta.status).toBe(404);
  });

  it('a etapa de geração não serve um build que já terminou', async () => {
    statusDoBuild = 'finished';
    const resposta = await postarBuild(requisicao('/api/internal/build', { buildId: BUILD }));
    expect(resposta.status).toBe(404);
  });

  it('build aprovado não devolve credencial em nenhuma etapa', async () => {
    statusDoBuild = 'approved';
    for (const etapa of ['build', 'submit']) {
      const resposta = await postarBuild(
        requisicao('/api/internal/build', { buildId: BUILD, etapa }),
      );
      expect(resposta.status).toBe(404);
    }
  });

  it('sem o segredo certo, nada sai', async () => {
    const resposta = await postarBuild(
      requisicao('/api/internal/build', { buildId: BUILD, etapa: 'submit' }, 'errado'),
    );
    expect(resposta.status).toBe(401);
  });
});

describe('POST /api/internal/build/status', () => {
  /*
   * A trava é por AVISO. Sem ela, o workflow de envio poderia marcar "enviado"
   * um build que nunca gerou nada, e uma reexecução do de geração reescreveria
   * como "gerando" um app já aprovado.
   */
  it('cada aviso só age a partir dos status que fazem sentido', async () => {
    const casos = [
      { status: 'building', origens: ['queued', 'building'] },
      { status: 'finished', origens: ['queued', 'building'] },
      { status: 'submitted', origens: ['finished'] },
      { status: 'errored', origens: ['queued', 'building', 'finished'] },
    ];

    for (const caso of casos) {
      filtros = [];
      await postarStatus(
        requisicao('/api/internal/build/status', { buildId: BUILD, status: caso.status }),
      );
      expect(filtros).toContainEqual({ coluna: 'status', valor: caso.origens });
    }
  });

  /*
   * A tradução é do servidor, e não do shell do workflow: a decisão de qual
   * passo manual mostrar tem teste, e um `grep` dentro de um YAML não tem.
   */
  it('a falha crua do envio vira instrução em português e passo manual', async () => {
    await postarStatus(
      requisicao('/api/internal/build/status', {
        buildId: BUILD,
        status: 'errored',
        etapa: 'submit',
        plataforma: 'android',
        erroBruto: 'googleapi: Error 404: Package not found',
      }),
    );

    expect(gravadoNoBuild?.manual_action).toBe('play_primeiro_envio');
    expect(String(gravadoNoBuild?.error)).toContain('PRIMEIRO');
  });

  it('falha da geração continua passando a mensagem como veio', async () => {
    await postarStatus(
      requisicao('/api/internal/build/status', {
        buildId: BUILD,
        status: 'errored',
        erro: 'A geração do app não terminou.',
      }),
    );

    expect(gravadoNoBuild?.error).toBe('A geração do app não terminou.');
    expect(gravadoNoBuild?.manual_action).toBeUndefined();
  });

  it('o envio bem-sucedido grava a submissão e a hora', async () => {
    await postarStatus(
      requisicao('/api/internal/build/status', {
        buildId: BUILD,
        status: 'submitted',
        submissionId: 'sub-1',
      }),
    );

    expect(gravadoNoBuild?.submission_id).toBe('sub-1');
    expect(typeof gravadoNoBuild?.submitted_at).toBe('string');
  });

  /*
   * O id do projeto Expo é da LOJA, não desta publicação. Gravá-lo no build
   * faria a publicação seguinte não achá-lo e criar um segundo projeto no Expo,
   * com metade do histórico em cada um.
   */
  it('o projeto Expo criado volta para o app, e só quando está vazio', async () => {
    await postarStatus(
      requisicao('/api/internal/build/status', {
        buildId: BUILD,
        status: 'building',
        expoProjectId: '55555555-5555-4555-8555-555555555555',
      }),
    );

    expect(gravadoNoApp).toEqual({ expo_project_id: '55555555-5555-4555-8555-555555555555' });
    expect(filtrosDoApp).toContainEqual({ metodo: 'eq', coluna: 'id', valor: APP });

    /*
     * A trava do `is null` é o que impede uma reexecução do workflow de
     * sobrescrever o projeto Expo que a loja JÁ tem: o id de um projeto não
     * muda, e trocá-lo órfãozaria todo o histórico de builds dela no Expo.
     */
    expect(filtrosDoApp).toContainEqual({ metodo: 'is', coluna: 'expo_project_id', valor: null });
  });

  it('sem projeto Expo no aviso, o app não é tocado', async () => {
    await postarStatus(
      requisicao('/api/internal/build/status', { buildId: BUILD, status: 'building' }),
    );
    expect(gravadoNoApp).toBeNull();
  });

  it('status que o runner não conhece vira 400', async () => {
    for (const status of ['approved', 'in_review', 'rejected', 'queued', 'inventado']) {
      const resposta = await postarStatus(
        requisicao('/api/internal/build/status', { buildId: BUILD, status }),
      );
      expect(resposta.status).toBe(400);
    }
  });

  it('sem o segredo certo, nada é gravado', async () => {
    const resposta = await postarStatus(
      requisicao('/api/internal/build/status', { buildId: BUILD, status: 'finished' }, 'errado'),
    );
    expect(resposta.status).toBe(401);
    expect(gravadoNoBuild).toBeNull();
  });
});

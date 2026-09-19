import { describe, expect, it, vi } from 'vitest';
import {
  corpoDaCriacao,
  criarAppDaLoja,
  diagnosticar,
  lerRespostaDaCriacao,
  type CredenciaisDaLoja,
} from '@/lib/onesignal-org';

const CREDENCIAIS: CredenciaisDaLoja = {
  nome: 'Oak Vintage',
  bundleId: 'com.oakvintage.app',
  apnsP8: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
  apnsKeyId: 'ABC123',
  appleTeamId: 'TEAM123',
  fcmServiceAccountJson: '{"type":"service_account"}',
};

describe('diagnosticar', () => {
  const completo = {
    orgApiKey: 'chave-da-org',
    appleVerificada: true,
    googleVerificada: true,
    bundleId: 'com.oakvintage.app',
  };

  it('com tudo pronto, não há pendência', () => {
    expect(diagnosticar(completo)).toEqual([]);
  });

  /*
   * A lista de pendências é a diferença entre "não funcionou" e "falta a chave
   * da Apple, que só você pode gerar". Por isso ela também diz de QUEM é cada
   * pendência: o lojista não deve ficar esperando por algo que é nosso, nem o
   * contrário.
   */
  it('separa o que é nosso do que é do lojista', () => {
    const semNada = diagnosticar({
      orgApiKey: undefined,
      appleVerificada: false,
      googleVerificada: false,
      bundleId: null,
    });

    expect(semNada).toHaveLength(4);
    expect(semNada.filter((p) => p.de === 'storefy')).toHaveLength(2);
    expect(semNada.filter((p) => p.de === 'lojista')).toHaveLength(2);
  });

  it('cada pendência diz o que fazer, sem jargão', () => {
    const todas = diagnosticar({
      orgApiKey: '',
      appleVerificada: false,
      googleVerificada: false,
      bundleId: '',
    });
    for (const pendencia of todas) {
      expect(pendencia.texto.length).toBeGreaterThan(20);
      expect(pendencia.texto).not.toMatch(/onesignal|apns|p8|fcm|bundle|json|api key/i);
    }
  });

  it('aponta exatamente o que falta, e só isso', () => {
    expect(diagnosticar({ ...completo, appleVerificada: false })).toHaveLength(1);
    expect(diagnosticar({ ...completo, appleVerificada: false })[0]?.texto).toContain('Apple');
    expect(diagnosticar({ ...completo, googleVerificada: false })[0]?.texto).toContain('Google');
  });
});

describe('corpoDaCriacao', () => {
  /*
   * Um campo com o nome trocado aqui não dá erro de compilação nem de rede: o
   * app é criado sem a credencial de iOS, e a descoberta acontece quando a
   * primeira campanha não chega em nenhum iPhone.
   */
  it('manda cada credencial no campo que a OneSignal espera', () => {
    expect(corpoDaCriacao(CREDENCIAIS)).toEqual({
      name: 'Oak Vintage',
      apns_env: 'production',
      apns_p8: CREDENCIAIS.apnsP8,
      apns_key_id: 'ABC123',
      apns_team_id: 'TEAM123',
      apns_bundle_id: 'com.oakvintage.app',
      fcm_v1_service_account_json: '{"type":"service_account"}',
    });
  });

  /*
   * `production` por padrão. Um app de loja publicado é sempre production;
   * `sandbox` num app da App Store faz NENHUMA notificação chegar, e o sintoma
   * é indistinguível de "ninguém aceitou notificações".
   */
  it('usa production por padrão, e sandbox só quando pedido', () => {
    expect(corpoDaCriacao(CREDENCIAIS).apns_env).toBe('production');
    expect(corpoDaCriacao({ ...CREDENCIAIS, ambienteApns: 'sandbox' }).apns_env).toBe('sandbox');
  });
});

describe('lerRespostaDaCriacao', () => {
  it('sucesso devolve o app e a chave', () => {
    const r = lerRespostaDaCriacao(
      200,
      JSON.stringify({ id: 'os-app-1', basic_auth_key: 'chave-rest' }),
    );
    expect(r).toEqual({ ok: true, app: { appId: 'os-app-1', chaveRest: 'chave-rest' } });
  });

  /*
   * A chave REST só aparece na resposta da criação. Aceitar uma resposta sem
   * ela deixaria um app criado na OneSignal que a Storefy não consegue usar —
   * e a correção seria apagar o app e criar outro.
   */
  it('sucesso SEM a chave é tratado como falha', () => {
    const r = lerRespostaDaCriacao(200, JSON.stringify({ id: 'os-app-1' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('chaves');
  });

  it('sucesso sem id também é falha', () => {
    expect(lerRespostaDaCriacao(200, JSON.stringify({ basic_auth_key: 'x' })).ok).toBe(false);
  });

  it('erro da chave da Apple vira instrução em pt-BR', () => {
    const r = lerRespostaDaCriacao(400, JSON.stringify({ errors: ['Invalid apns_p8 provided'] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain('Apple');
      expect(r.motivo).not.toContain('apns_p8');
    }
  });

  it('erro do arquivo do Google vira instrução em pt-BR', () => {
    const r = lerRespostaDaCriacao(
      400,
      JSON.stringify({ errors: { fcm: ['service account is malformed'] } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('Google');
  });

  it('erro desconhecido passa como veio, para o suporte procurar por ele', () => {
    const r = lerRespostaDaCriacao(422, JSON.stringify({ errors: ['Quota exceeded for org'] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('Quota exceeded for org');
  });

  it('resposta ilegível não derruba nada', () => {
    for (const texto of ['<html>', '', 'null', '42']) {
      const r = lerRespostaDaCriacao(500, texto);
      expect(r.ok).toBe(false);
    }
  });
});

describe('criarAppDaLoja', () => {
  it('chama o endpoint de apps com a chave da organização', async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    const buscador = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'os-1', basic_auth_key: 'rest-1' })),
      );
    }) as unknown as typeof fetch;

    const r = await criarAppDaLoja('chave-da-org', CREDENCIAIS, buscador);

    expect(r.ok).toBe(true);
    expect(chamadas[0]?.url).toBe('https://api.onesignal.com/apps');
    const cabecalhos = chamadas[0]?.init.headers as Record<string, string>;
    expect(cabecalhos.Authorization).toBe('Key chave-da-org');
  });

  it('rede caindo vira mensagem, não exceção', async () => {
    const quebrado = (() => Promise.reject(new Error('sem rede'))) as unknown as typeof fetch;
    const r = await criarAppDaLoja('chave', CREDENCIAIS, quebrado);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('Tente de novo');
  });

  it('nunca devolve a chave da organização na mensagem de erro', async () => {
    const recusado = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ errors: ['unauthorized'] }), { status: 401 }),
      )) as unknown as typeof fetch;

    const r = await criarAppDaLoja('CHAVE-SECRETA-DA-ORG', CREDENCIAIS, recusado);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).not.toContain('CHAVE-SECRETA-DA-ORG');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOTIVO_NAO_ENVIADO,
  MOTIVO_SEM_CONFIGURACAO,
  TIPO_DO_EVENTO_DE_SUBMISSAO,
  dispararSubmissao,
  interpretarFalhaDoEnvio,
} from '@/lib/submissao';

const BUILD = '11111111-1111-4111-8111-111111111111';

let tokenOriginal: string | undefined;
let repoOriginal: string | undefined;

beforeEach(() => {
  tokenOriginal = process.env.GITHUB_DISPATCH_TOKEN;
  repoOriginal = process.env.GITHUB_REPO;
  process.env.GITHUB_DISPATCH_TOKEN = 'token-de-teste';
  process.env.GITHUB_REPO = 'convertfy/storefy';
});

afterEach(() => {
  if (tokenOriginal === undefined) delete process.env.GITHUB_DISPATCH_TOKEN;
  else process.env.GITHUB_DISPATCH_TOKEN = tokenOriginal;
  if (repoOriginal === undefined) delete process.env.GITHUB_REPO;
  else process.env.GITHUB_REPO = repoOriginal;
  vi.unstubAllGlobals();
});

describe('dispararSubmissao', () => {
  it('pede o workflow de envio ao GitHub', async () => {
    let url = '';
    let corpo = '';
    const falso: typeof fetch = (entrada, init) => {
      url = entrada instanceof Request ? entrada.url : entrada.toString();
      corpo = typeof init?.body === 'string' ? init.body : '';
      return Promise.resolve(new Response(null, { status: 204 }));
    };

    expect(await dispararSubmissao(BUILD, falso)).toEqual({ ok: true });
    expect(url).toBe('https://api.github.com/repos/convertfy/storefy/dispatches');

    const enviado: unknown = JSON.parse(corpo);
    expect(enviado).toEqual({
      event_type: TIPO_DO_EVENTO_DE_SUBMISSAO,
      client_payload: { buildId: BUILD },
    });
  });

  /*
   * O `client_payload` fica visível para quem tem acesso de leitura às
   * execuções do repositório. Nenhuma credencial pode passar por aqui: o runner
   * busca o que precisa numa rota autenticada.
   */
  it('o payload leva só o identificador', async () => {
    let corpo = '';
    const falso: typeof fetch = (_entrada, init) => {
      corpo = typeof init?.body === 'string' ? init.body : '';
      return Promise.resolve(new Response(null, { status: 204 }));
    };

    await dispararSubmissao(BUILD, falso);
    const enviado = JSON.parse(corpo) as { client_payload: Record<string, unknown> };
    expect(Object.keys(enviado.client_payload)).toEqual(['buildId']);
  });

  it('sem token ou repositório, recusa com o motivo da configuração', async () => {
    const naoDeveriaChamar: typeof fetch = () => {
      throw new Error('não deveria chamar o GitHub');
    };

    delete process.env.GITHUB_DISPATCH_TOKEN;
    expect(await dispararSubmissao(BUILD, naoDeveriaChamar)).toEqual({
      ok: false,
      motivo: MOTIVO_SEM_CONFIGURACAO,
    });

    process.env.GITHUB_DISPATCH_TOKEN = 'token-de-teste';
    process.env.GITHUB_REPO = 'sem-barra';
    expect(await dispararSubmissao(BUILD, naoDeveriaChamar)).toEqual({
      ok: false,
      motivo: MOTIVO_SEM_CONFIGURACAO,
    });
  });

  it('resposta diferente de 204 vira recusa', async () => {
    for (const status of [401, 403, 404, 422, 500]) {
      const falso: typeof fetch = () => Promise.resolve(new Response(null, { status }));
      expect(await dispararSubmissao(BUILD, falso)).toEqual({
        ok: false,
        motivo: MOTIVO_NAO_ENVIADO,
      });
    }
  });

  it('rede fora do ar vira recusa, e não exceção', async () => {
    const falso: typeof fetch = () => Promise.reject(new Error('sem rede'));
    expect(await dispararSubmissao(BUILD, falso)).toEqual({
      ok: false,
      motivo: MOTIVO_NAO_ENVIADO,
    });
  });

  /*
   * As duas mensagens falam com o LOJISTA, não com o nosso time: ele acabou de
   * ver "gerando" virar erro, e precisa saber que o arquivo existe e o que
   * fazer com ele.
   */
  it('os motivos dizem ao lojista que o app existe e o que fazer', () => {
    for (const motivo of [MOTIVO_SEM_CONFIGURACAO, MOTIVO_NAO_ENVIADO]) {
      expect(motivo).toContain('gerado');
      expect(motivo.toLowerCase()).toContain('baixe');
      expect(motivo).not.toMatch(/HTTP|dispatch|token|workflow/i);
    }
  });
});

describe('interpretarFalhaDoEnvio', () => {
  /*
   * O caso que mais importa. O Play Console exige que o PRIMEIRO `.aab` de um
   * pacote seja subido à mão — nenhuma API publica um app que ainda não existe
   * lá. É regra do Google e vale uma vez por app; mostrar isso como erro seco
   * faria o lojista abrir chamado achando que o produto quebrou.
   */
  it('primeiro envio ao Google vira o passo a passo, e não um erro seco', () => {
    for (const texto of [
      'Error: Could not find app with package name br.com.loja',
      'googleapi: Error 404: Package not found: br.com.loja',
      'The app has never been uploaded to Google Play',
      'Only releases with status draft may be created on draft app',
    ]) {
      const falha = interpretarFalhaDoEnvio('android', texto);
      expect(falha.acaoManual).toBe('play_primeiro_envio');
      expect(falha.mensagem).toContain('PRIMEIRO');
    }
  });

  /** A mesma frase na Apple NÃO é o caso do Google. */
  it('o mesmo texto no iOS não vira o passo do Google', () => {
    expect(interpretarFalhaDoEnvio('ios', 'Could not find app').acaoManual).not.toBe(
      'play_primeiro_envio',
    );
  });

  it('credencial recusada manda reconectar a conta', () => {
    for (const texto of [
      'Invalid credentials for service account',
      'The service account is unauthorized',
    ]) {
      const falha = interpretarFalhaDoEnvio('android', texto);
      expect(falha.mensagem).toContain('Reconecte');
      expect(falha.acaoManual).toBeNull();
    }
  });

  it('app inexistente na App Store Connect manda criar o registro', () => {
    const falha = interpretarFalhaDoEnvio('ios', 'Could not find App Store Connect App');
    expect(falha.mensagem).toContain('Bundle ID');
    expect(falha.acaoManual).toBeNull();
  });

  /*
   * O que não dá para reconhecer vira envio manual, e não um erro sem saída: o
   * binário existe, e o lojista consegue subi-lo sozinho enquanto a gente
   * investiga.
   */
  it('falha desconhecida ainda deixa uma saída para o lojista', () => {
    const falha = interpretarFalhaDoEnvio('ios', 'Fastlane exploded at line 900');
    expect(falha.acaoManual).toBe('envio_manual');
    expect(falha.mensagem).toBe('Fastlane exploded at line 900');
  });

  it('sem texto nenhum, ainda diz algo útil', () => {
    const falha = interpretarFalhaDoEnvio('android', '   ');
    expect(falha.acaoManual).toBe('envio_manual');
    expect(falha.mensagem.length).toBeGreaterThan(20);
    expect(falha.mensagem).not.toContain('undefined');
  });

  it('corta mensagem gigante', () => {
    expect(interpretarFalhaDoEnvio('ios', 'x'.repeat(9000)).mensagem.length).toBe(2000);
  });
});

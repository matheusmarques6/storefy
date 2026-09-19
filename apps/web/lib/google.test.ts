/**
 * A parte que dá para provar daqui é a asserção JWT: ela é gerada com uma
 * chave RSA de verdade e VERIFICADA com o `node:crypto`. Se a assinatura
 * estivesse errada, o Google responderia `invalid_grant` — que é a mesma
 * resposta de conta apagada, e mandaria o lojista gerar chave atrás de chave.
 */
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ESCOPO_DO_PLAY,
  URL_DO_TOKEN,
  VALIDADE_DO_TOKEN_S,
  lerContaDeServico,
  lerRespostaDoGoogle,
  montarAssercao,
  validarContaDoGoogle,
} from '@/lib/google';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVADA = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUBLICA = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const ARQUIVO = JSON.stringify({
  type: 'service_account',
  project_id: 'oakvintage-123',
  client_email: 'storefy@oakvintage-123.iam.gserviceaccount.com',
  private_key: PRIVADA,
});
const AGORA = 1_800_000_000;

function jwtConfere(token: string): boolean {
  const partes = token.split('.');
  if (partes.length !== 3) return false;

  const verificador = createVerify('RSA-SHA256');
  verificador.update(`${partes[0] ?? ''}.${partes[1] ?? ''}`);
  verificador.end();
  return verificador.verify(PUBLICA, Buffer.from(partes[2] ?? '', 'base64url'));
}

describe('lerContaDeServico', () => {
  it('lê o arquivo certo', () => {
    const r = lerContaDeServico(ARQUIVO);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.conta.client_email).toBe('storefy@oakvintage-123.iam.gserviceaccount.com');
      expect(r.conta.project_id).toBe('oakvintage-123');
    }
  });

  /*
   * O engano mais comum de todos: o arquivo de credenciais OAuth, que também é
   * JSON e também vem do Google Cloud. Dizer o nome dele na mensagem economiza
   * uma ida ao suporte — "JSON inválido" mandaria o lojista conferir o arquivo
   * errado mil vezes.
   */
  it('reconhece o arquivo de OAuth e diz onde achar o certo', () => {
    const oauth = JSON.stringify({
      type: 'authorized_user',
      client_id: '123.apps.googleusercontent.com',
      client_secret: 'xyz',
    });
    const r = lerContaDeServico(oauth);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain('OAuth');
      expect(r.motivo).toContain('Contas de serviço');
    }
  });

  it('cada recusa diz o que fazer, em pt-BR', () => {
    const casos = [
      'não é json',
      '[]',
      'null',
      JSON.stringify({ type: 'service_account' }),
      JSON.stringify({ type: 'service_account', client_email: 'sem-arroba' }),
      JSON.stringify({ type: 'service_account', client_email: 'a@b.com' }),
    ];
    for (const texto of casos) {
      const r = lerContaDeServico(texto);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.motivo.length).toBeGreaterThan(20);
        expect(r.motivo).not.toMatch(/undefined|null|JSON\.parse|TypeError/);
      }
    }
  });

  it('aceita arquivo sem `type`, que algumas exportações omitem', () => {
    const semTipo = JSON.stringify({
      client_email: 'a@b.iam.gserviceaccount.com',
      private_key: PRIVADA,
    });
    expect(lerContaDeServico(semTipo).ok).toBe(true);
  });
});

describe('montarAssercao', () => {
  const conta = { client_email: 'storefy@x.iam.gserviceaccount.com', private_key: PRIVADA };

  it('produz um JWT que confere com a chave pública', () => {
    expect(jwtConfere(montarAssercao(conta, ESCOPO_DO_PLAY, AGORA))).toBe(true);
  });

  it('põe issuer, escopo, audiência e validade no corpo', () => {
    const corpo = montarAssercao(conta, ESCOPO_DO_PLAY, AGORA).split('.')[1];
    expect(JSON.parse(Buffer.from(corpo ?? '', 'base64url').toString())).toEqual({
      iss: 'storefy@x.iam.gserviceaccount.com',
      scope: ESCOPO_DO_PLAY,
      aud: URL_DO_TOKEN,
      iat: AGORA,
      exp: AGORA + VALIDADE_DO_TOKEN_S,
    });
  });

  /*
   * Pedir só o escopo do Play, e não `cloud-platform`: uma conta de serviço
   * com escopo amplo, guardada por nós, é risco desnecessário para o cliente —
   * e é o tipo de coisa que aparece numa auditoria de segurança dele.
   */
  it('pede só o escopo do Google Play', () => {
    expect(ESCOPO_DO_PLAY).toBe('https://www.googleapis.com/auth/androidpublisher');
    expect(ESCOPO_DO_PLAY).not.toContain('cloud-platform');
  });

  /*
   * A `private_key` chega com `\n` escapado quando passa por um campo de texto
   * ou por uma variável de ambiente. Sem desescapar, uma chave boa vira
   * "chave inválida" — e o lojista gera outra, que chega escapada igual.
   */
  it('aceita a chave com as quebras de linha escapadas', () => {
    const escapada = { ...conta, private_key: PRIVADA.replace(/\n/g, '\\n') };
    expect(jwtConfere(montarAssercao(escapada, ESCOPO_DO_PLAY, AGORA))).toBe(true);
  });

  it('não usa base64 comum: `+` e `/` quebram o JWT', () => {
    const token = montarAssercao(conta, ESCOPO_DO_PLAY, AGORA);
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
    expect(token).not.toContain('=');
  });
});

describe('lerRespostaDoGoogle', () => {
  const email = 'a@b.iam.gserviceaccount.com';

  it('token de acesso vale como conta boa', () => {
    const r = lerRespostaDoGoogle(200, JSON.stringify({ access_token: 'ya29.x' }), email);
    expect(r).toEqual({ ok: true, email });
  });

  it('200 sem token não vale', () => {
    expect(lerRespostaDoGoogle(200, '{}', email).ok).toBe(false);
  });

  it('conta apagada ou chave revogada manda gerar outra', () => {
    const r = lerRespostaDoGoogle(400, JSON.stringify({ error: 'invalid_grant' }), email);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('chave JSON nova');
  });

  /*
   * API desligada é o segundo erro mais comum, e tem conserto de um clique no
   * console do Google. Tratá-lo como "conta inválida" faria o lojista apagar
   * uma conta de serviço que estava certa.
   */
  it('API desligada manda ligar a API, e não trocar a conta', () => {
    const r = lerRespostaDoGoogle(
      403,
      JSON.stringify({
        error: 'SERVICE_DISABLED',
        error_description: 'Google Play Android Developer API has not been used in project',
      }),
      email,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain('Ative');
      expect(r.motivo).not.toContain('chave JSON nova');
    }
  });

  it('indisponibilidade manda tentar de novo', () => {
    const r = lerRespostaDoGoogle(503, '', email);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('Tente de novo');
  });

  it('corpo ilegível não derruba nada', () => {
    expect(lerRespostaDoGoogle(400, '<html>', email).ok).toBe(false);
  });
});

describe('validarContaDoGoogle', () => {
  it('troca o JWT por um token no endereço certo', async () => {
    const chamadas: { url: string; corpo: string }[] = [];
    const buscador = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const enviado = init?.body;
      chamadas.push({
        url: url instanceof Request ? url.url : url.toString(),
        corpo: typeof enviado === 'string' ? enviado : '',
      });
      return Promise.resolve(new Response(JSON.stringify({ access_token: 'ya29.x' })));
    }) as unknown as typeof fetch;

    const r = await validarContaDoGoogle(ARQUIVO, buscador, AGORA);

    expect(r.ok).toBe(true);
    expect(chamadas[0]?.url).toBe(URL_DO_TOKEN);

    const corpo = new URLSearchParams(chamadas[0]?.corpo ?? '');
    expect(corpo.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(jwtConfere(corpo.get('assertion') ?? '')).toBe(true);
  });

  it('arquivo errado nem chega a chamar o Google', async () => {
    const buscador = vi.fn(() => Promise.resolve(new Response('{}'))) as unknown as typeof fetch;
    const r = await validarContaDoGoogle('{"type":"authorized_user"}', buscador, AGORA);

    expect(r.ok).toBe(false);
    expect(vi.mocked(buscador)).not.toHaveBeenCalled();
  });

  it('chave malformada vira mensagem, não exceção', async () => {
    const ruim = JSON.stringify({
      type: 'service_account',
      client_email: 'a@b.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nlixo\n-----END PRIVATE KEY-----',
    });
    const buscador = vi.fn(() => Promise.resolve(new Response('{}'))) as unknown as typeof fetch;

    const r = await validarContaDoGoogle(ruim, buscador, AGORA);
    expect(r.ok).toBe(false);
  });

  it('rede caindo vira mensagem, não exceção', async () => {
    const quebrado = (() => Promise.reject(new Error('sem rede'))) as unknown as typeof fetch;
    const r = await validarContaDoGoogle(ARQUIVO, quebrado, AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('Google');
  });

  it('nunca devolve a chave privada na mensagem de erro', async () => {
    const recusado = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
      )) as unknown as typeof fetch;

    const r = await validarContaDoGoogle(ARQUIVO, recusado, AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).not.toContain('PRIVATE KEY');
  });
});

/**
 * A parte desta integração que dá para provar daqui é a ASSINATURA, e é
 * justamente a que se erra em silêncio: `createSign` do Node devolve DER, e o
 * JOSE quer os dois números crus de 32 bytes. Entregar DER à Apple dá "401 sem
 * explicação" — o erro mais caro de depurar nesta API, porque parece chave
 * errada.
 *
 * O teste gera pares de chaves de verdade, assina e VERIFICA com o
 * `node:crypto`, em centenas de repetições: a conversão tem um caso raro (o
 * número que cabe em menos de 32 bytes) que só aparece em algumas assinaturas.
 */
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  BASE_DA_API,
  VALIDADE_DO_TOKEN_S,
  derParaJose,
  lerRespostaDaApple,
  montarToken,
  pareceChaveP8,
  validarChaveDaApple,
} from '@/lib/apple';

/** Um par ES256 de verdade, como o `.p8` que a Apple entrega. */
function parDeChaves(): { privada: string; publica: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privada: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publica: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

const CHAVES = parDeChaves();
const CREDENCIAL = { p8: CHAVES.privada, keyId: 'ABC123DEFG', issuerId: 'aaaa-bbbb-cccc' };
const AGORA = 1_800_000_000;

/** Verifica o JWT do jeito que a Apple verifica: ES256 sobre `cabecalho.corpo`. */
function jwtConfere(token: string, publica: string): boolean {
  const partes = token.split('.');
  if (partes.length !== 3) return false;

  const verificador = createVerify('SHA256');
  verificador.update(`${partes[0] ?? ''}.${partes[1] ?? ''}`);
  verificador.end();

  return verificador.verify(
    { key: publica, dsaEncoding: 'ieee-p1363' },
    Buffer.from(partes[2] ?? '', 'base64url'),
  );
}

describe('pareceChaveP8', () => {
  it('aceita uma chave de verdade', () => {
    expect(pareceChaveP8(CHAVES.privada)).toBe(true);
    expect(pareceChaveP8(`\n  ${CHAVES.privada}  \n`)).toBe(true);
  });

  it('recusa o que claramente não é chave', () => {
    for (const lixo of ['', '   ', 'ABC123', 'meu-arquivo.p8', '{"type":"service_account"}']) {
      expect(pareceChaveP8(lixo)).toBe(false);
    }
  });
});

describe('montarToken', () => {
  /*
   * A prova central: o token que montamos é verificável com a chave pública do
   * par. Se a conversão DER→JOSE estivesse errada, isto seria falso — e a
   * Apple diria só "401".
   */
  it('produz um JWT que confere com a chave pública', () => {
    expect(jwtConfere(montarToken(CREDENCIAL, AGORA), CHAVES.publica)).toBe(true);
  });

  it('confere em 200 assinaturas seguidas, com chaves diferentes', () => {
    // O `r` ou o `s` que cabe em menos de 32 bytes acontece em cerca de uma
    // assinatura a cada 256. Duzentas repetições cobrem esse caso.
    for (let i = 0; i < 200; i += 1) {
      const par = parDeChaves();
      const token = montarToken({ ...CREDENCIAL, p8: par.privada }, AGORA + i);
      expect(jwtConfere(token, par.publica)).toBe(true);
    }
  });

  it('põe no cabeçalho o que a Apple exige', () => {
    const [cabecalho] = montarToken(CREDENCIAL, AGORA).split('.');
    const lido = JSON.parse(Buffer.from(cabecalho ?? '', 'base64url').toString()) as {
      alg: string;
      kid: string;
      typ: string;
    };
    expect(lido).toEqual({ alg: 'ES256', kid: 'ABC123DEFG', typ: 'JWT' });
  });

  it('põe no corpo o issuer, a validade e a audiência fixa da Apple', () => {
    const corpo = montarToken(CREDENCIAL, AGORA).split('.')[1];
    const lido = JSON.parse(Buffer.from(corpo ?? '', 'base64url').toString()) as Record<
      string,
      unknown
    >;
    expect(lido).toEqual({
      iss: 'aaaa-bbbb-cccc',
      iat: AGORA,
      exp: AGORA + VALIDADE_DO_TOKEN_S,
      aud: 'appstoreconnect-v1',
    });
  });

  it('a validade fica dentro do teto de 20 minutos da Apple', () => {
    expect(VALIDADE_DO_TOKEN_S).toBeLessThanOrEqual(20 * 60);
  });

  it('não usa base64 comum: `+` e `/` quebram o JWT', () => {
    const token = montarToken(CREDENCIAL, AGORA);
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
    expect(token).not.toContain('=');
  });
});

describe('derParaJose', () => {
  it('devolve sempre 64 bytes', () => {
    for (let i = 0; i < 50; i += 1) {
      const par = parDeChaves();
      const token = montarToken({ ...CREDENCIAL, p8: par.privada }, AGORA + i);
      const bruta = Buffer.from(token.split('.')[2] ?? '', 'base64url');
      expect(bruta).toHaveLength(64);
    }
  });

  /**
   * Monta um DER à mão: SEQUENCE { INTEGER r, INTEGER s }.
   *
   * Os dois casos que interessam — o número curto e o número com zero à
   * esquerda — aparecem em cerca de uma assinatura a cada 128. Esperar que
   * apareçam num laço é teste sorteado, que passa num dia e falha no outro;
   * aqui eles são construídos de propósito.
   */
  function der(r: Buffer, s: Buffer): Buffer {
    const conteudo = Buffer.concat([
      Buffer.from([0x02, r.length]),
      r,
      Buffer.from([0x02, s.length]),
      s,
    ]);
    return Buffer.concat([Buffer.from([0x30, conteudo.length]), conteudo]);
  }

  it('completa com zero à esquerda o número que veio curto', () => {
    // `r` com 31 bytes é DER válido: o DER não escreve zeros inúteis. O JOSE
    // exige 32, e sem completar a assinatura sai com 63 bytes e a Apple
    // responde 401 — sem dizer por quê.
    const r = Buffer.alloc(31, 0x11);
    const s = Buffer.alloc(32, 0x22);

    const jose = derParaJose(der(r, s));

    expect(jose).toHaveLength(64);
    expect(jose[0]).toBe(0x00);
    expect(jose.subarray(1, 32)).toEqual(r);
    expect(jose.subarray(32)).toEqual(s);
  });

  it('completa os dois números quando os dois vieram curtos', () => {
    const jose = derParaJose(der(Buffer.alloc(20, 0x11), Buffer.alloc(28, 0x22)));
    expect(jose).toHaveLength(64);
    expect(jose.subarray(0, 12)).toEqual(Buffer.alloc(12, 0x00));
    expect(jose.subarray(32, 36)).toEqual(Buffer.alloc(4, 0x00));
  });

  it('tira o zero à esquerda que o DER acrescenta', () => {
    // 33 bytes começando em 0x00: o DER põe esse zero quando o número
    // começaria com bit 1, para não parecer negativo. O JOSE não quer.
    const r = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(32, 0xff)]);
    const s = Buffer.alloc(32, 0x22);

    const jose = derParaJose(der(r, s));

    expect(jose).toHaveLength(64);
    expect(jose.subarray(0, 32)).toEqual(Buffer.alloc(32, 0xff));
    expect(jose.subarray(32)).toEqual(s);
  });

  it('recusa entrada que não é DER, em vez de devolver lixo', () => {
    for (const ruim of [Buffer.alloc(0), Buffer.from([1, 2, 3]), Buffer.alloc(80, 0xff)]) {
      expect(() => derParaJose(ruim)).toThrow();
    }
  });
});

describe('lerRespostaDaApple', () => {
  it('2xx vale como chave boa', () => {
    const r = lerRespostaDaApple(200, JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }));
    expect(r).toEqual({ ok: true, apps: 2 });
  });

  it('2xx com corpo ilegível ainda vale: a chave respondeu', () => {
    expect(lerRespostaDaApple(200, '<html>').ok).toBe(true);
  });

  it('401 manda conferir os identificadores, que é o erro comum', () => {
    const r = lerRespostaDaApple(401, '{}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain('Key ID');
      expect(r.motivo).toContain('Issuer ID');
    }
  });

  /*
   * 403 é chave certa com papel de menos. Dizer "chave inválida" aqui faria o
   * lojista gerar outra chave igual e falhar de novo — e cada tentativa dessas
   * custa uma ida ao App Store Connect.
   */
  it('403 manda gerar com o papel certo, e não trocar a chave', () => {
    const r = lerRespostaDaApple(403, '{}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain('Admin');
      expect(r.motivo).not.toContain('Key ID');
    }
  });

  it('erro do servidor manda tentar de novo', () => {
    for (const status of [500, 502, 503]) {
      const r = lerRespostaDaApple(status, '');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toContain('Tente de novo');
    }
  });
});

describe('validarChaveDaApple', () => {
  it('chama a API da Apple com o token no cabeçalho', async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    const buscador = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
      return Promise.resolve(new Response(JSON.stringify({ data: [] })));
    }) as unknown as typeof fetch;

    const r = await validarChaveDaApple(CREDENCIAL, buscador, AGORA);

    expect(r.ok).toBe(true);
    expect(chamadas[0]?.url).toBe(`${BASE_DA_API}/v1/apps?limit=1`);
    const cabecalhos = chamadas[0]?.init.headers as Record<string, string>;
    expect(
      jwtConfere((cabecalhos.Authorization ?? '').replace('Bearer ', ''), CHAVES.publica),
    ).toBe(true);
  });

  /*
   * Recusar antes de chamar economiza uma ida à Apple e, mais importante, dá
   * uma mensagem que diz o que fazer — a Apple responderia 401, que não
   * distingue "arquivo errado" de "identificador errado".
   */
  it('recusa arquivo que não é chave sem nem chamar a Apple', async () => {
    const buscador = vi.fn(() => Promise.resolve(new Response('{}'))) as unknown as typeof fetch;

    const r = await validarChaveDaApple({ ...CREDENCIAL, p8: 'não é chave' }, buscador, AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('.p8');
    expect(vi.mocked(buscador)).not.toHaveBeenCalled();
  });

  it('cobra Key ID e Issuer ID antes de tentar', async () => {
    const buscador = vi.fn(() => Promise.resolve(new Response('{}'))) as unknown as typeof fetch;

    for (const faltando of [{ keyId: '' }, { issuerId: '  ' }]) {
      const r = await validarChaveDaApple({ ...CREDENCIAL, ...faltando }, buscador, AGORA);
      expect(r.ok).toBe(false);
    }
    expect(vi.mocked(buscador)).not.toHaveBeenCalled();
  });

  it('chave malformada vira mensagem, não exceção', async () => {
    const quebrada = `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(200)}\n-----END PRIVATE KEY-----`;
    const buscador = vi.fn(() => Promise.resolve(new Response('{}'))) as unknown as typeof fetch;

    const r = await validarChaveDaApple({ ...CREDENCIAL, p8: quebrada }, buscador, AGORA);
    expect(r.ok).toBe(false);
  });

  it('rede caindo vira mensagem, não exceção', async () => {
    const quebrado = (() => Promise.reject(new Error('sem rede'))) as unknown as typeof fetch;
    const r = await validarChaveDaApple(CREDENCIAL, quebrado, AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('Apple');
  });

  it('nunca devolve a chave privada na mensagem de erro', async () => {
    const recusado = (() =>
      Promise.resolve(new Response('{}', { status: 401 }))) as unknown as typeof fetch;

    const r = await validarChaveDaApple(CREDENCIAL, recusado, AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).not.toContain('PRIVATE KEY');
  });
});

/**
 * A prova de que o SHA-256 daqui é o SHA-256 de verdade.
 *
 * Criptografia escrita à mão só vale com verificação implacável: um bug de um
 * bit passa em todo teste caseiro e falha em produção como "a assinatura não
 * confere em alguns aparelhos". Por isso o teste não inventa expectativas —
 * compara com o `node:crypto`, que é a mesma implementação que o servidor usa
 * para conferir. Se os dois concordam em milhares de entradas, eles concordam.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { escreverTamanho, hmacSha256, paraBytes, paraHex, sha256 } from './hmac.ts';

const doNode = (dados: Uint8Array): string =>
  createHash('sha256').update(Buffer.from(dados)).digest('hex');

const hmacDoNode = (chave: Uint8Array, dados: Uint8Array): string =>
  createHmac('sha256', Buffer.from(chave)).update(Buffer.from(dados)).digest('hex');

describe('sha256', () => {
  it('bate com os vetores clássicos da RFC', () => {
    expect(paraHex(sha256(paraBytes('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(paraHex(sha256(paraBytes('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  /*
   * Os tamanhos que importam são os da fronteira do padding: 55 bytes ainda
   * cabem no bloco com o 0x80 e os 8 do tamanho; 56 já forçam um bloco extra.
   * É exatamente aí que uma implementação errada passa em tudo menos num caso.
   */
  it('acerta todos os tamanhos de 0 a 200 bytes', () => {
    for (let n = 0; n <= 200; n += 1) {
      const dados = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) dados[i] = (i * 31 + 7) & 0xff;
      expect(paraHex(sha256(dados))).toBe(doNode(dados));
    }
  });

  it('acerta 500 entradas aleatórias de tamanhos variados', () => {
    for (let i = 0; i < 500; i += 1) {
      const dados = new Uint8Array(randomBytes(Math.floor(Math.random() * 4096)));
      expect(paraHex(sha256(dados))).toBe(doNode(dados));
    }
  });

  it('acerta entradas maiores que um corpo de requisição', () => {
    for (const n of [4096, 10_000, 65_536]) {
      const dados = new Uint8Array(randomBytes(n));
      expect(paraHex(sha256(dados))).toBe(doNode(dados));
    }
  });

  it('muda inteiro quando um bit muda', () => {
    const a = paraHex(sha256(paraBytes('carrinho')));
    const b = paraHex(sha256(paraBytes('carrinhp')));
    expect(a).not.toBe(b);
  });
});

describe('hmacSha256', () => {
  it('acerta o vetor 2 da RFC 4231', () => {
    expect(paraHex(hmacSha256(paraBytes('Jefe'), paraBytes('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('acerta 300 combinações aleatórias de chave e mensagem', () => {
    for (let i = 0; i < 300; i += 1) {
      const chave = new Uint8Array(randomBytes(1 + Math.floor(Math.random() * 200)));
      const dados = new Uint8Array(randomBytes(Math.floor(Math.random() * 2048)));
      expect(paraHex(hmacSha256(chave, dados))).toBe(hmacDoNode(chave, dados));
    }
  });

  /*
   * Chave maior que o bloco (64 bytes) é substituída pelo próprio hash, e
   * menor é completada com zeros. Errar isso passaria em quase todo teste: as
   * chaves que geramos têm 43 caracteres.
   */
  it('acerta nas fronteiras do tamanho da chave', () => {
    for (const n of [1, 63, 64, 65, 128, 200]) {
      const chave = new Uint8Array(randomBytes(n));
      const dados = paraBytes('{"appId":"x"}');
      expect(paraHex(hmacSha256(chave, dados))).toBe(hmacDoNode(chave, dados));
    }
  });
});

describe('paraBytes', () => {
  it('codifica acento, cedilha e emoji igual ao Node', () => {
    for (const texto of [
      'Promoções',
      'Calçados & Roupas',
      'ação',
      '日本語',
      'carrinho 🛒 cheio',
      '{"nome":"Café à brasileira"}',
    ]) {
      expect(Buffer.from(paraBytes(texto))).toEqual(Buffer.from(texto, 'utf8'));
    }
  });

  it('o hash de um texto com acento bate com o do Node', () => {
    const texto = '{"loja":"Oak Vintage","evento":"adição ao carrinho"}';
    expect(paraHex(sha256(paraBytes(texto)))).toBe(
      createHash('sha256').update(texto, 'utf8').digest('hex'),
    );
  });
});

describe('paraHex', () => {
  it('põe o zero à esquerda, sempre', () => {
    expect(paraHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
  });

  it('devolve sempre 64 caracteres para um sha256', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(paraHex(sha256(new Uint8Array(randomBytes(i))))).toHaveLength(64);
    }
  });
});

describe('escreverTamanho', () => {
  /** Lê de volta os 8 bytes finais como um número, do jeito que o SHA-256 os escreve. */
  function escrever(bytes: number): bigint {
    const buffer = new ArrayBuffer(64);
    escreverTamanho(new DataView(buffer), 64, bytes);
    return new DataView(buffer).getBigUint64(56, false);
  }

  it('escreve o tamanho em bits, não em bytes', () => {
    expect(escrever(0)).toBe(0n);
    expect(escrever(1)).toBe(8n);
    expect(escrever(55)).toBe(440n);
  });

  /*
   * Aqui está o motivo de a função existir: 2^29 bytes são 2^32 bits, e é o
   * primeiro tamanho em que escrever só os 32 bits de baixo dá zero. Uma
   * entrada dessas nunca vai aparecer neste app, mas a conta ou está certa ou
   * está errada — e um teste que só usa corpos de requisição nunca descobre.
   */
  it('não perde a metade de cima a partir de meio gigabyte', () => {
    expect(escrever(0x2000_0000)).toBe(0x1_0000_0000n);
    expect(escrever(0x2000_0001)).toBe(0x1_0000_0008n);
    expect(escrever(0x3fff_ffff)).toBe(0x1_ffff_fff8n);
  });

  it('bate com a conta feita em bigint para tamanhos aleatórios', () => {
    for (let i = 0; i < 200; i += 1) {
      const bytes = Math.floor(Math.random() * 0x8000_0000);
      expect(escrever(bytes)).toBe(BigInt(bytes) * 8n);
    }
  });
});

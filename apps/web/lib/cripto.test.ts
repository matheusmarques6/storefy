import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ErroDeCriptografia,
  criptografar,
  criptografiaConfigurada,
  descriptografar,
  iguaisEmTempoConstante,
} from '@/lib/cripto';

const CHAVE = Buffer.alloc(32, 7).toString('base64');
const OUTRA_CHAVE = Buffer.alloc(32, 9).toString('base64');
const SEGREDO = 'os_v2_app_chave_rest_do_onesignal';

let chaveOriginal: string | undefined;

beforeEach(() => {
  chaveOriginal = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = CHAVE;
});

afterEach(() => {
  if (chaveOriginal === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = chaveOriginal;
});

describe('criptografar e descriptografar', () => {
  it('vai e volta', () => {
    expect(descriptografar(criptografar(SEGREDO))).toBe(SEGREDO);
  });

  it('aguenta acento, emoji e texto longo', () => {
    for (const texto of ['ção', '🔐 chave', 'x'.repeat(10_000), '{"json":true}']) {
      expect(descriptografar(criptografar(texto))).toBe(texto);
    }
  });

  it('o mesmo texto cifra diferente a cada vez', () => {
    // Reaproveitar IV em GCM quebra a cifra inteira, não só aquela mensagem.
    const a = criptografar(SEGREDO);
    const b = criptografar(SEGREDO);
    expect(a).not.toBe(b);
    expect(descriptografar(a)).toBe(descriptografar(b));
  });

  it('o pacote não contém o texto em claro', () => {
    expect(criptografar(SEGREDO)).not.toContain('onesignal');
  });

  it('RECUSA pacote adulterado', () => {
    // É o que o GCM traz de diferente do CBC: byte trocado falha ao abrir, em
    // vez de virar lixo que o código usaria como se fosse a chave.
    const pacote = criptografar(SEGREDO);
    const partes = pacote.split('.');
    const cifrado = Buffer.from(partes[2] ?? '', 'base64');
    cifrado[0] = (cifrado[0] ?? 0) ^ 0xff;
    partes[2] = cifrado.toString('base64');

    expect(() => descriptografar(partes.join('.'))).toThrow(ErroDeCriptografia);
  });

  it('RECUSA pacote com a tag trocada', () => {
    const partes = criptografar(SEGREDO).split('.');
    partes[3] = Buffer.alloc(16, 1).toString('base64');
    expect(() => descriptografar(partes.join('.'))).toThrow(ErroDeCriptografia);
  });

  it('RECUSA pacote cifrado com outra chave', () => {
    const pacote = criptografar(SEGREDO);
    process.env.ENCRYPTION_KEY = OUTRA_CHAVE;
    expect(() => descriptografar(pacote)).toThrow(ErroDeCriptografia);
  });

  it('recusa formato desconhecido em vez de tentar adivinhar', () => {
    for (const pacote of ['', 'abc', 'v2.a.b.c', 'v1.a.b', 'v1.a.b.c.d', 'v1...']) {
      expect(() => descriptografar(pacote), pacote).toThrow(ErroDeCriptografia);
    }
  });

  it('FALHA ALTO sem a chave, em vez de gravar em claro', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => criptografar(SEGREDO)).toThrow(/ENCRYPTION_KEY/);
    expect(criptografiaConfigurada()).toBe(false);
  });

  it('recusa chave do tamanho errado', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => criptografar(SEGREDO)).toThrow(/32 bytes/);
    expect(criptografiaConfigurada()).toBe(false);
  });

  it('reconhece a chave certa', () => {
    expect(criptografiaConfigurada()).toBe(true);
  });
});

describe('iguaisEmTempoConstante', () => {
  it('compara como o `===` compararia', () => {
    expect(iguaisEmTempoConstante('abc', 'abc')).toBe(true);
    expect(iguaisEmTempoConstante('abc', 'abd')).toBe(false);
    expect(iguaisEmTempoConstante('abc', 'abcd')).toBe(false);
    expect(iguaisEmTempoConstante('', '')).toBe(true);
  });

  it('não estoura com tamanhos diferentes', () => {
    // `timingSafeEqual` do Node lança quando os tamanhos diferem; o tamanho em
    // si não é segredo, então devolver `false` é o certo.
    expect(() => iguaisEmTempoConstante('a', 'bbbbbbbb')).not.toThrow();
  });
});

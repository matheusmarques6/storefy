/**
 * SHA-256 e HMAC-SHA256 em TypeScript puro.
 *
 * POR QUE ESCREVER ISTO À MÃO: o app precisa assinar o que manda para
 * `/api/public/devices` e `/api/public/events`, e o React Native não tem
 * `node:crypto`. As alternativas eram piores:
 *
 *   - `expo-crypto` faz SHA-256 de STRING e devolve hexadecimal. HMAC precisa
 *     hashear BYTES (a chave sofre XOR com 0x36 e 0x5c, o que produz bytes
 *     arbitrários) e precisa do resultado em bytes para a segunda passagem.
 *     Passar esses bytes como string perde informação no caminho do UTF-8, e o
 *     erro só apareceria como "assinatura não confere" em alguns aparelhos.
 *   - uma biblioteca de criptografia a mais é dependência nativa a mais num
 *     app que já precisa passar na revisão da Apple.
 *
 * SHA-256 é um algoritmo fechado e pequeno, e o teste compara esta
 * implementação com a do Node em centenas de entradas aleatórias, incluindo os
 * tamanhos exatos onde o padding muda de bloco. É o tipo de código que se
 * escreve uma vez e se prova por inteiro.
 *
 * Nada aqui é segredo: o valor assinado viaja no binário de qualquer jeito.
 */

/** As 64 constantes do SHA-256 (raízes cúbicas dos primeiros 64 primos). */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** O estado inicial (raízes quadradas dos primeiros 8 primos). */
const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/** Tamanho do bloco do SHA-256, em bytes. É o que o HMAC usa para o padding. */
const BLOCO = 64;

/**
 * Leitura com valor de reserva.
 *
 * `noUncheckedIndexedAccess` está ligado no projeto e faz todo índice de array
 * ser `number | undefined`, inclusive em `Uint32Array`. O `?? 0` aqui nunca
 * acontece na prática — os índices são todos calculados dentro do tamanho —
 * mas é mais honesto do que desligar a checagem para o arquivo inteiro.
 */
function em(vetor: Uint32Array | Uint8Array, i: number): number {
  return vetor[i] ?? 0;
}

/**
 * Escreve o tamanho da mensagem, em BITS, nos últimos 8 bytes do padding.
 *
 * São 64 bits big-endian, e escrever só os 32 de baixo funcionaria para tudo
 * que este app assina — um corpo de requisição tem uns poucos KB. Está
 * separado em função própria justamente porque a metade de cima só entra em
 * jogo a partir de meio gigabyte de entrada: dentro do `sha256` ela seria uma
 * linha que nenhum teste alcança sem alocar 512 MB. Aqui o teste a alcança com
 * um buffer de 64 bytes e um número.
 */
export function escreverTamanho(visao: DataView, total: number, bytes: number): void {
  const bits = bytes * 8;
  visao.setUint32(total - 8, Math.floor(bits / 0x1_0000_0000), false);
  visao.setUint32(total - 4, bits >>> 0, false);
}

function girar(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** Digere uma sequência de bytes e devolve os 32 bytes do resultado. */
export function sha256(mensagem: Uint8Array): Uint8Array {
  /*
   * Padding: 0x80, zeros, e o tamanho EM BITS nos últimos 8 bytes, big-endian.
   * O `+ 9` é o 0x80 mais os 8 bytes do tamanho; o arredondamento leva ao
   * múltiplo de 64 seguinte.
   */
  const total = ((mensagem.length + 9 + (BLOCO - 1)) & ~(BLOCO - 1)) >>> 0;
  const dados = new Uint8Array(total);
  dados.set(mensagem);
  dados[mensagem.length] = 0x80;

  const visao = new DataView(dados.buffer);
  escreverTamanho(visao, total, mensagem.length);

  const h = H0.slice();
  const w = new Uint32Array(64);

  for (let inicio = 0; inicio < total; inicio += BLOCO) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = visao.getUint32(inicio + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const a = em(w, i - 15);
      const b = em(w, i - 2);
      const s0 = (girar(a, 7) ^ girar(a, 18) ^ (a >>> 3)) >>> 0;
      const s1 = (girar(b, 17) ^ girar(b, 19) ^ (b >>> 10)) >>> 0;
      w[i] = (em(w, i - 16) + s0 + em(w, i - 7) + s1) >>> 0;
    }

    let a = em(h, 0);
    let b = em(h, 1);
    let c = em(h, 2);
    let d = em(h, 3);
    let e = em(h, 4);
    let f = em(h, 5);
    let g = em(h, 6);
    let x = em(h, 7);

    for (let i = 0; i < 64; i += 1) {
      const s1 = (girar(e, 6) ^ girar(e, 11) ^ girar(e, 25)) >>> 0;
      const escolha = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (x + s1 + escolha + em(K, i) + em(w, i)) >>> 0;
      const s0 = (girar(a, 2) ^ girar(a, 13) ^ girar(a, 22)) >>> 0;
      const maioria = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (s0 + maioria) >>> 0;

      x = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    h[0] = (em(h, 0) + a) >>> 0;
    h[1] = (em(h, 1) + b) >>> 0;
    h[2] = (em(h, 2) + c) >>> 0;
    h[3] = (em(h, 3) + d) >>> 0;
    h[4] = (em(h, 4) + e) >>> 0;
    h[5] = (em(h, 5) + f) >>> 0;
    h[6] = (em(h, 6) + g) >>> 0;
    h[7] = (em(h, 7) + x) >>> 0;
  }

  const saida = new Uint8Array(32);
  const saidaVisao = new DataView(saida.buffer);
  for (let i = 0; i < 8; i += 1) saidaVisao.setUint32(i * 4, em(h, i), false);
  return saida;
}

/** HMAC-SHA256 (RFC 2104) sobre bytes. */
export function hmacSha256(chave: Uint8Array, mensagem: Uint8Array): Uint8Array {
  // Chave maior que o bloco é substituída pelo próprio hash; menor, completada
  // com zeros. É essa normalização que faz duas chaves diferentes de tamanhos
  // diferentes não colidirem.
  const normalizada = new Uint8Array(BLOCO);
  normalizada.set(chave.length > BLOCO ? sha256(chave) : chave);

  const interno = new Uint8Array(BLOCO + mensagem.length);
  const externo = new Uint8Array(BLOCO + 32);
  for (let i = 0; i < BLOCO; i += 1) {
    interno[i] = em(normalizada, i) ^ 0x36;
    externo[i] = em(normalizada, i) ^ 0x5c;
  }
  interno.set(mensagem, BLOCO);
  externo.set(sha256(interno), BLOCO);

  return sha256(externo);
}

/** Converte bytes em hexadecimal minúsculo, que é como a assinatura viaja. */
export function paraHex(bytes: Uint8Array): string {
  let saida = '';
  for (const byte of bytes) saida += byte.toString(16).padStart(2, '0');
  return saida;
}

/**
 * Texto em bytes UTF-8.
 *
 * `TextEncoder` existe no Hermes desde o React Native 0.74; o caminho manual
 * fica como reserva para não depender disso — um acento no nome da loja
 * codificado errado vira assinatura inválida, e o sintoma seria "o push não
 * funciona em alguns aparelhos", que é caríssimo de descobrir.
 */
export function paraBytes(texto: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(texto);

  const bytes: number[] = [];
  for (const caractere of texto) {
    let ponto = caractere.codePointAt(0) ?? 0;
    if (ponto < 0x80) {
      bytes.push(ponto);
    } else if (ponto < 0x800) {
      bytes.push(0xc0 | (ponto >> 6), 0x80 | (ponto & 0x3f));
    } else if (ponto < 0x1_0000) {
      bytes.push(0xe0 | (ponto >> 12), 0x80 | ((ponto >> 6) & 0x3f), 0x80 | (ponto & 0x3f));
    } else {
      bytes.push(
        0xf0 | (ponto >> 18),
        0x80 | ((ponto >> 12) & 0x3f),
        0x80 | ((ponto >> 6) & 0x3f),
        0x80 | (ponto & 0x3f),
      );
      ponto = 0;
    }
  }
  return new Uint8Array(bytes);
}

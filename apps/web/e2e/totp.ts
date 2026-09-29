/**
 * O código do app autenticador, calculado como o celular calcula (RFC 6238:
 * HMAC-SHA1, passo de 30 segundos, seis dígitos) — é o que deixa o e2e
 * entrar no admin com o segundo fator de verdade, sem atalho no Auth.
 */
import { createHmac } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function bytesDoSegredo(segredo: string): Buffer {
  const limpo = segredo.replace(/[\s=]/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let acumulado = 0;
  for (const letra of limpo) {
    const indice = BASE32.indexOf(letra);
    if (indice === -1)
      throw new Error(`Segredo do app autenticador com caractere inválido: ${letra}`);
    acumulado = (acumulado << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acumulado >>> bits) & 0xff);
      acumulado &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

/** O código que o app mostraria no instante `quando` (em milissegundos). */
export function codigoTotp(segredo: string, quando = Date.now()): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(quando / 30_000)));
  const hmac = createHmac('sha1', bytesDoSegredo(segredo)).update(contador).digest();
  const deslocamento = (hmac.at(-1) ?? 0) & 0x0f;
  const numero = (hmac.readUInt32BE(deslocamento) & 0x7fffffff) % 1_000_000;
  return String(numero).padStart(6, '0');
}

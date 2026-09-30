import { describe, expect, it } from 'vitest';
import { clienteDesistiu } from '@/lib/cliente-desistiu';

describe('clienteDesistiu', () => {
  it('a resposta que o cliente deixou no meio do caminho', () => {
    expect(clienteDesistiu(new Error('The destination stream closed early.'))).toBe(true);
    expect(clienteDesistiu(Object.assign(new Error('aborted'), { code: 'ECONNRESET' }))).toBe(true);
  });

  it('a falha nossa continua sendo erro, até com a mesma causa', () => {
    const chamadaNossa = new TypeError('fetch failed', {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    });
    expect(clienteDesistiu(chamadaNossa)).toBe(false);
    expect(clienteDesistiu(new Error('aborted'))).toBe(false);
    expect(clienteDesistiu(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(clienteDesistiu('The destination stream closed early.')).toBe(false);
  });
});

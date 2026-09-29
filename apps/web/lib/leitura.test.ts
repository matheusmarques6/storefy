import { describe, expect, it } from 'vitest';
import { lido } from '@/lib/leitura';

describe('lido', () => {
  it('devolve a leitura que deu certo, do jeito que veio', () => {
    const resultado = { data: [{ id: 1 }], error: null };
    expect(lido(resultado, 'as campanhas')).toBe(resultado);
  });

  it('lança com o que se tentava ler, em vez de devolver vazio', () => {
    expect(() => lido({ data: null, error: { message: 'timeout' } }, 'as campanhas')).toThrow(
      'Não foi possível ler as campanhas: timeout',
    );
  });
});

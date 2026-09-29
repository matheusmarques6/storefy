import { describe, expect, it } from 'vitest';
import { fundoDoApp } from '@/lib/fundo-do-app';

describe('fundoDoApp', () => {
  it('a cor de fundo do tema, quando é hexadecimal', () => {
    expect(fundoDoApp({ theme: { background: '#112233' } })).toBe('#112233');
    expect(fundoDoApp({ theme: { background: '#FFF' } })).toBe('#FFF');
  });

  /* O Expo recusa o build com cor que não entende: branco em vez de quebrar. */
  it('o que não é cor que o Expo aceita vira branco', () => {
    for (const config of [
      null,
      'texto',
      {},
      { theme: null },
      { theme: { background: 'red' } },
      { theme: { background: '#11223344' } },
      { theme: { background: 42 } },
    ]) {
      expect(fundoDoApp(config), JSON.stringify(config)).toBe('#ffffff');
    }
  });
});

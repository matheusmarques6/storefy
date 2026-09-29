import { describe, expect, it } from 'vitest';
import { configInicial } from '@storefy/config-schema';
import {
  comAtualizacaoObrigatoria,
  exigeAtualizacao,
  numeroExigivel,
  versaoDoNumero,
} from '@/lib/atualizacao-obrigatoria';

describe('numeroExigivel', () => {
  it('sem nada aprovado, não há o que exigir', () => {
    expect(numeroExigivel([])).toBeNull();
  });

  /*
   * O caso que importa: o contador é do app, e o número mais novo de uma
   * plataforma não existe na outra. Exigir o 60 travaria quem usa Android,
   * que só tem até o 55.
   */
  it('é o MENOR entre os últimos aprovados de cada plataforma', () => {
    expect(
      numeroExigivel([
        { plataforma: 'ios', numero: 58 },
        { plataforma: 'ios', numero: 60 },
        { plataforma: 'android', numero: 55 },
        { plataforma: 'android', numero: 41 },
      ]),
    ).toBe(55);
  });

  it('com uma plataforma só, é o último dela', () => {
    expect(numeroExigivel([{ plataforma: 'android', numero: 12 }])).toBe(12);
  });
});

describe('a config', () => {
  const base = configInicial({ name: 'Loja', url: 'https://loja.com.br' }, 3);

  it('nasce sem exigir nada', () => {
    expect(exigeAtualizacao(base)).toBe(false);
  });

  it('liga e desliga sem mexer no resto', () => {
    const exigindo = comAtualizacaoObrigatoria(base, 55);
    expect(exigindo.minSupportedBuild).toBe(55);
    expect(exigeAtualizacao(exigindo)).toBe(true);
    expect({ ...exigindo, minSupportedBuild: base.minSupportedBuild }).toEqual(base);

    expect(exigeAtualizacao(comAtualizacaoObrigatoria(exigindo, null))).toBe(false);
  });

  it('a versão que a loja mostra acompanha o número', () => {
    expect(versaoDoNumero(55)).toBe('1.0.55');
  });
});

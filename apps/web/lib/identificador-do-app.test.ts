import { describe, expect, it } from 'vitest';
import {
  FORMATO_DO_IDENTIFICADOR,
  alternativasDoIdentificador,
  identificadorSugerido,
  normalizarIdentificador,
  problemaDoIdentificador,
} from '@/lib/identificador-do-app';

describe('identificadorSugerido', () => {
  it('é o domínio da loja ao contrário, mais .app', () => {
    expect(identificadorSugerido('https://oakvintage.com.br', 'Oak Vintage')).toBe(
      'br.com.oakvintage.app',
    );
    expect(identificadorSugerido('https://www.lojadamaria.com', 'Loja da Maria')).toBe(
      'com.lojadamaria.app',
    );
  });

  it('limpa o que as lojas de aplicativos recusam: hífen, acento, número na frente', () => {
    expect(identificadorSugerido('https://loja-editor.com.br', 'x')).toBe('br.com.lojaeditor.app');
    expect(identificadorSugerido('https://123presentes.com.br', 'x')).toBe(
      'br.com.n123presentes.app',
    );
  });

  it('palavra reservada do Android ganha um complemento', () => {
    expect(identificadorSugerido('https://new.com.br', 'x')).toBe('br.com.newapp.app');
  });

  it('sem domínio próprio, sai do nome da loja — sem carregar o nome da Shopify', () => {
    expect(identificadorSugerido('https://oak-vintage.myshopify.com', 'Óak Vintage!')).toBe(
      'com.oakvintage.app',
    );
    expect(identificadorSugerido('não é url', '###')).toBe('com.minhaloja.app');
  });

  it('a sugestão sempre passa pela própria regra', () => {
    for (const [url, nome] of [
      ['https://a.b', 'x'],
      ['https://sub.dominio.loja.com.br', 'Loja'],
      ['https://true.com', 'y'],
      ['http://localhost:3000', 'Loja Local'],
    ] as const) {
      const sugerido = identificadorSugerido(url, nome);
      expect(problemaDoIdentificador(sugerido)).toBeNull();
      expect(FORMATO_DO_IDENTIFICADOR.test(sugerido)).toBe(true);
    }
  });
});

describe('problemaDoIdentificador', () => {
  it('aceita o formato das duas lojas e grava em minúsculas', () => {
    expect(problemaDoIdentificador('br.com.oakvintage.app')).toBeNull();
    expect(problemaDoIdentificador('  BR.com.OakVintage.app ')).toBeNull();
    expect(normalizarIdentificador('  BR.com.OakVintage.app ')).toBe('br.com.oakvintage.app');
  });

  it('recusa com uma frase que diz o que fazer', () => {
    expect(problemaDoIdentificador('')).toBe('Informe o identificador do app.');
    expect(problemaDoIdentificador('semponto')).toContain('separadas por ponto');
    expect(problemaDoIdentificador('br.com.loja-x.app')).toContain('só letras minúsculas');
    expect(problemaDoIdentificador('br.com.loja_x.app')).toContain('só letras minúsculas');
    expect(problemaDoIdentificador('br.com.1loja.app')).toContain('só letras minúsculas');
    expect(problemaDoIdentificador('br..app')).toContain('só letras minúsculas');
    expect(problemaDoIdentificador(`com.${'a'.repeat(150)}`)).toContain('150 caracteres');
  });

  it('o prefixo da Apple e as palavras do Java ficam de fora', () => {
    expect(problemaDoIdentificador('com.apple.loja')).toContain('são da Apple');
    expect(problemaDoIdentificador('br.com.class.app')).toBe(
      '"class" é uma palavra reservada no Android e não pode ser parte do identificador.',
    );
  });
});

describe('alternativasDoIdentificador', () => {
  it('numera a partir do 2, para oferecer a primeira livre', () => {
    expect(alternativasDoIdentificador('br.com.loja.app', 3)).toEqual([
      'br.com.loja.app',
      'br.com.loja.app2',
      'br.com.loja.app3',
    ]);
  });
});

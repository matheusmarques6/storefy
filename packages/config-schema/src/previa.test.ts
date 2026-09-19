import { describe, expect, it } from 'vitest';
import { ESQUEMA_DA_PREVIA, ehTokenDePrevia, lerTokenDePrevia, urlDaPrevia } from './previa';

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('ehTokenDePrevia', () => {
  it('aceita o que o banco gera', () => {
    expect(ehTokenDePrevia(TOKEN)).toBe(true);
    expect(ehTokenDePrevia(TOKEN.toUpperCase())).toBe(true);
    expect(ehTokenDePrevia(`  ${TOKEN}  `)).toBe(true);
  });

  it('recusa o resto', () => {
    for (const valor of ['', 'abc', `${TOKEN}0`, TOKEN.slice(1), 'g'.repeat(32)]) {
      expect(ehTokenDePrevia(valor), valor).toBe(false);
    }
  });
});

describe('lerTokenDePrevia', () => {
  it('lê o deep link que a câmera nativa entrega', () => {
    expect(lerTokenDePrevia(`${ESQUEMA_DA_PREVIA}://p/${TOKEN}`)).toBe(TOKEN);
  });

  it('lê o código digitado à mão, com ou sem espaço', () => {
    expect(lerTokenDePrevia(` ${TOKEN.toUpperCase()} `)).toBe(TOKEN);
  });

  it('ignora query e âncora no fim do link', () => {
    expect(lerTokenDePrevia(`${ESQUEMA_DA_PREVIA}://p/${TOKEN}?v=1`)).toBe(TOKEN);
    expect(lerTokenDePrevia(`https://storefy.com/p/${TOKEN}#abrir`)).toBe(TOKEN);
  });

  it('devolve null quando não há código no texto', () => {
    for (const valor of ['', '   ', 'storefy-preview://p/', 'https://storefy.com', 'oi']) {
      expect(lerTokenDePrevia(valor), valor).toBeNull();
    }
  });

  it('não confunde um pedaço de hash com o código', () => {
    // 31 e 33 caracteres não passam; só o tamanho exato serve.
    expect(lerTokenDePrevia(`link/${TOKEN.slice(1)}`)).toBeNull();
  });
});

describe('urlDaPrevia', () => {
  it('monta o endereço do rascunho', () => {
    expect(urlDaPrevia('https://storefy.convertfy.me', TOKEN)).toBe(
      `https://storefy.convertfy.me/api/public/preview-config/${TOKEN}`,
    );
  });

  it('tolera barra sobrando e normaliza o código', () => {
    expect(urlDaPrevia('https://storefy.convertfy.me//', TOKEN.toUpperCase())).toBe(
      `https://storefy.convertfy.me/api/public/preview-config/${TOKEN}`,
    );
  });

  it('devolve null sem base ou com código inválido', () => {
    expect(urlDaPrevia('', TOKEN)).toBeNull();
    expect(urlDaPrevia('https://storefy.convertfy.me', 'abc')).toBeNull();
    expect(urlDaPrevia('javascript:alert(1)', TOKEN)).toBeNull();
    expect(urlDaPrevia('não é url', TOKEN)).toBeNull();
  });
});

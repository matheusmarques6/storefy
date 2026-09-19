import { describe, expect, it } from 'vitest';
import { destinoDoPush, linkDaNotificacao } from './deep-link.ts';

const LOJA = 'https://oakvintage.com.br';
const DOMINIOS = ['oakvintage.com.br', 'www.oakvintage.com.br'];

describe('linkDaNotificacao', () => {
  it('lê o deep_link que o nosso despachante põe', () => {
    expect(linkDaNotificacao({ additionalData: { deep_link: '/promocoes' } })).toBe('/promocoes');
  });

  it('aceita o launchURL do próprio OneSignal como reserva', () => {
    expect(linkDaNotificacao({ launchURL: 'https://oakvintage.com.br/novidades' })).toBe(
      'https://oakvintage.com.br/novidades',
    );
  });

  it('prefere o nosso campo quando os dois vêm', () => {
    expect(
      linkDaNotificacao({ additionalData: { deep_link: '/a' }, launchURL: 'https://x.com/b' }),
    ).toBe('/a');
  });

  it('tira o espaço que o lojista digitou sem querer', () => {
    expect(linkDaNotificacao({ additionalData: { deep_link: '  /promocoes  ' } })).toBe(
      '/promocoes',
    );
  });

  it('devolve vazio quando não há link', () => {
    for (const notificacao of [
      {},
      { additionalData: null },
      { additionalData: 'texto' },
      { additionalData: { deep_link: '' } },
      { additionalData: { deep_link: 42 } },
      { launchURL: '   ' },
    ]) {
      expect(linkDaNotificacao(notificacao)).toBe('');
    }
  });
});

describe('destinoDoPush', () => {
  it('leva ao caminho da loja', () => {
    expect(destinoDoPush('/colecoes/inverno', LOJA, DOMINIOS)).toEqual({
      destino: 'caminho',
      caminho: '/colecoes/inverno',
    });
  });

  it('aceita a URL inteira da loja', () => {
    expect(destinoDoPush('https://oakvintage.com.br/promocoes', LOJA, DOMINIOS)).toEqual({
      destino: 'caminho',
      caminho: '/promocoes',
    });
  });

  it('aceita o www, que é a mesma loja', () => {
    expect(destinoDoPush('https://www.oakvintage.com.br/x', LOJA, DOMINIOS)).toEqual({
      destino: 'caminho',
      caminho: '/x',
    });
  });

  it('mantém a busca e o fragmento, que fazem parte do destino', () => {
    expect(destinoDoPush('/search?q=tenis', LOJA, DOMINIOS)).toEqual({
      destino: 'caminho',
      caminho: '/search?q=tenis',
    });
    expect(destinoDoPush('/produto/x#avaliacoes', LOJA, DOMINIOS)).toEqual({
      destino: 'caminho',
      caminho: '/produto/x#avaliacoes',
    });
  });

  /*
   * O caso que justifica a função existir. Uma notificação é texto que alguém
   * escreveu num painel; abrir um host qualquer numa WebView sem barra de
   * endereço, com o ícone e o nome da loja em volta, é uma tela de phishing
   * pronta. Domínio de fora vira "só abre o app".
   */
  it('NÃO abre host de fora: vira só abrir o app', () => {
    for (const link of [
      'https://site-falso.com.br/entrar',
      // Prefixo colado: o domínio TERMINA com o da loja sem ser subdomínio
      // dela. É registrável hoje, por qualquer um, e passa por qualquer
      // comparação feita com `endsWith` sem o ponto.
      'https://falsooakvintage.com.br/entrar',
      'https://nao-oakvintage.com.br/entrar',
      // Sufixo colado: a loja vira prefixo de um domínio de terceiro.
      'https://oakvintage.com.br.site-falso.com/x',
      'http://oakvintagexcom.br/x',
      'https://evil.com/oakvintage.com.br',
    ]) {
      expect(destinoDoPush(link, LOJA, DOMINIOS)).toEqual({ destino: 'abrir' });
    }
  });

  it('NÃO abre esquema que não seja http(s)', () => {
    for (const link of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<h1>x</h1>',
      'tel:+5511999999999',
    ]) {
      expect(destinoDoPush(link, LOJA, DOMINIOS)).toEqual({ destino: 'abrir' });
    }
  });

  it('sem link, só abre o app', () => {
    expect(destinoDoPush('', LOJA, DOMINIOS)).toEqual({ destino: 'abrir' });
    expect(destinoDoPush('   ', LOJA, DOMINIOS)).toEqual({ destino: 'abrir' });
  });

  it('link ilegível não derruba nada', () => {
    expect(destinoDoPush('http://[', LOJA, DOMINIOS)).toEqual({ destino: 'abrir' });
  });

  it('funciona com a lista de domínios vazia, usando a URL da loja', () => {
    expect(destinoDoPush('/x', LOJA, [])).toEqual({ destino: 'caminho', caminho: '/x' });
    expect(destinoDoPush('https://outra.com.br/x', LOJA, [])).toEqual({ destino: 'abrir' });
  });

  it('aceita domínio listado sem esquema, que é como o lojista digita', () => {
    expect(destinoDoPush('https://loja.com.br/x', LOJA, ['loja.com.br'])).toEqual({
      destino: 'caminho',
      caminho: '/x',
    });
  });
});

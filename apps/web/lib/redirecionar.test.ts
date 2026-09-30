import { describe, expect, it } from 'vitest';
import { caminhoDoSite, destinoSeguro, redirecionarPara } from '@/lib/redirecionar';

describe('redirecionarPara', () => {
  /*
   * O defeito: `new URL('/', requisicao.url)` levava o host em que o servidor
   * escuta. Relativo, quem resolve é o navegador, com o endereço que ele pediu.
   */
  it('manda Location RELATIVO, sem host nenhum', () => {
    const resposta = redirecionarPara('/integracoes?shopify=erro');
    expect(resposta.status).toBe(303);
    expect(resposta.headers.get('location')).toBe('/integracoes?shopify=erro');
  });

  it('recusa sair do site', () => {
    for (const fora of ['https://outro.site', '//outro.site/x', '/\\outro.site', 'integracoes']) {
      expect(() => redirecionarPara(fora), fora).toThrow();
    }
  });

  it('recusa o caminho que o navegador leria como outro site', () => {
    for (const fora of ['/\t/outro.site', '/\n/outro.site', '/..//outro.site']) {
      expect(() => redirecionarPara(fora), JSON.stringify(fora)).toThrow();
    }
  });

  it('cookies continuam sendo gravados na resposta', () => {
    const resposta = redirecionarPara('/');
    resposta.cookies.set('teste', 'valor');
    expect(resposta.headers.get('set-cookie')).toContain('teste=valor');
  });
});

/*
 * O `proximo` do login vem da URL, e a URL é de quem mandou o link. O golpe:
 * um link para a página de login VERDADEIRA que, depois da senha, leva a uma
 * cópia da Storefy pedindo a senha "de novo".
 */
describe('destinoSeguro', () => {
  it('o caminho deste site passa, com a busca e a âncora', () => {
    expect(destinoSeguro('/')).toBe('/');
    expect(destinoSeguro('/configuracoes')).toBe('/configuracoes');
    expect(destinoSeguro('/push/nova?loja=1#texto')).toBe('/push/nova?loja=1#texto');
  });

  it('outro site, disfarçado de qualquer jeito, vira o início', () => {
    for (const fora of [
      'https://outro.site/login',
      '//outro.site/login',
      '/\\outro.site/login',
      // O navegador tira TAB e quebra de linha antes de ler: viraria `//outro.site`.
      '/\t/outro.site',
      '/\n/outro.site',
      '/\r\n/outro.site',
      // O leitor resolve o `..` e sobra `//outro.site`.
      '/..//outro.site',
      '/./..//outro.site',
      'javascript:alert(1)',
      'outro.site',
      '',
    ]) {
      expect(destinoSeguro(fora), JSON.stringify(fora)).toBe('/');
    }
  });

  it('o que não é texto (um arquivo no formulário, nada) vira o início', () => {
    expect(destinoSeguro(null)).toBe('/');
    expect(destinoSeguro(undefined)).toBe('/');
    expect(destinoSeguro(new File(['x'], 'x.txt'))).toBe('/');
  });

  it('a barra codificada continua caminho daqui (e cai no 404 daqui)', () => {
    expect(caminhoDoSite('/%2F%2Foutro.site')).toBe('/%2F%2Foutro.site');
  });
});

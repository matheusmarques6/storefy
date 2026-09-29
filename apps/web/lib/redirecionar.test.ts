import { describe, expect, it } from 'vitest';
import { redirecionarPara } from '@/lib/redirecionar';

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

  it('cookies continuam sendo gravados na resposta', () => {
    const resposta = redirecionarPara('/');
    resposta.cookies.set('teste', 'valor');
    expect(resposta.headers.get('set-cookie')).toContain('teste=valor');
  });
});

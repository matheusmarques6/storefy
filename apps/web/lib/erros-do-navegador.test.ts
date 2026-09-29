import { describe, expect, it, vi } from 'vitest';
import { MAXIMO_POR_PAGINA, criarRelator, montarErroDoNavegador } from '@/lib/erros-do-navegador';

describe('montarErroDoNavegador', () => {
  it('monta o pacote com tipo, mensagem, pilha, página e onde', () => {
    const erro = new TypeError('x is undefined');
    expect(montarErroDoNavegador(erro, 'janela', '/publicacao')).toMatchObject({
      tipo: 'TypeError',
      mensagem: 'x is undefined',
      pagina: '/publicacao',
      onde: 'janela',
    });
  });

  it('a query da página não sai: pode levar o token de um convite', () => {
    expect(
      montarErroDoNavegador(new Error('x'), 'tela', '/convite/aceitar?token=segredo#topo')?.pagina,
    ).toBe('/convite/aceitar');
  });

  it('erro do servidor (com digest) não vai de novo: o servidor já relatou', () => {
    const doServidor = Object.assign(new Error('x'), { digest: '123' });
    expect(montarErroDoNavegador(doServidor, 'tela', '/')).toBeNull();
  });

  it('ruído conhecido e extensão do navegador não são defeito nosso', () => {
    for (const mensagem of [
      'ResizeObserver loop completed with undelivered notifications.',
      'Script error.',
      'NEXT_REDIRECT',
      'Failed to fetch',
      '   ',
    ]) {
      expect(montarErroDoNavegador(new Error(mensagem), 'janela', '/'), mensagem).toBeNull();
    }
    const deExtensao = new Error('quebrou');
    deExtensao.stack = 'Error: quebrou\n    at x (chrome-extension://abc/content.js:1:2)';
    expect(montarErroDoNavegador(deExtensao, 'janela', '/')).toBeNull();
  });

  it('aceita o que não é Error, como a promessa rejeitada com texto', () => {
    expect(montarErroDoNavegador('deu ruim', 'promessa', '/')).toMatchObject({
      tipo: 'Error',
      mensagem: 'deu ruim',
    });
  });

  it('corta o que é grande', () => {
    const erro = new Error('m'.repeat(2000));
    erro.stack = 's'.repeat(20_000);
    const pacote = montarErroDoNavegador(erro, 'janela', `/${'p'.repeat(1000)}`);
    expect(pacote?.mensagem.length).toBe(500);
    expect(pacote?.pilha?.length).toBe(5000);
    expect(pacote?.pagina.length).toBe(300);
  });
});

describe('criarRelator', () => {
  it('manda uma vez cada erro, e no máximo cinco por página', () => {
    const enviar = vi.fn();
    const relatar = criarRelator(enviar);

    expect(relatar(new Error('um'), 'janela', '/')).toBe(true);
    expect(relatar(new Error('um'), 'janela', '/')).toBe(false);
    for (let i = 0; i < 10; i++) relatar(new Error(`outro ${String(i)}`), 'janela', '/');

    expect(enviar).toHaveBeenCalledTimes(MAXIMO_POR_PAGINA);
    expect(JSON.parse(String(enviar.mock.calls[0]?.[0]))).toMatchObject({ mensagem: 'um' });
  });

  it('um envio que falha não vira outro erro', () => {
    const relatar = criarRelator(() => {
      throw new Error('sem rede');
    });
    expect(() => relatar(new Error('x'), 'janela', '/')).not.toThrow();
  });
});

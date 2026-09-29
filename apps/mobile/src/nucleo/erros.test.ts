import { describe, expect, it, vi } from 'vitest';
import {
  MAXIMO_POR_ABERTURA,
  criarRelatorDoApp,
  instalarRelatorDeErros,
  montarErroDoApp,
  type ManipuladorGlobal,
} from './erros';

describe('montarErroDoApp', () => {
  it('leva tipo, mensagem, pilha e se é fatal', () => {
    const erro = new TypeError('undefined is not an object');
    expect(montarErroDoApp(erro, true)).toMatchObject({
      tipo: 'TypeError',
      mensagem: 'undefined is not an object',
      fatal: true,
    });
  });

  it('aceita o que não é Error, e ignora o vazio', () => {
    expect(montarErroDoApp('deu ruim', false)?.mensagem).toBe('deu ruim');
    expect(montarErroDoApp('  ', false)).toBeNull();
  });

  it('corta o que é grande', () => {
    const erro = new Error('m'.repeat(1000));
    erro.stack = 's'.repeat(10_000);
    const pacote = montarErroDoApp(erro, false);
    expect(pacote?.mensagem.length).toBe(500);
    expect(pacote?.pilha?.length).toBe(5000);
  });
});

describe('criarRelatorDoApp', () => {
  it('uma vez cada erro, e no máximo cinco por abertura', () => {
    const enviar = vi.fn();
    const relatar = criarRelatorDoApp(enviar);
    relatar(new Error('um'), false);
    relatar(new Error('um'), false);
    for (let i = 0; i < 10; i++) relatar(new Error(`outro ${String(i)}`), false);
    expect(enviar).toHaveBeenCalledTimes(MAXIMO_POR_ABERTURA);
  });

  it('um envio que falha não vira outro erro', () => {
    const relatar = criarRelatorDoApp(() => {
      throw new Error('sem rede');
    });
    expect(() => relatar(new Error('x'), false)).not.toThrow();
  });
});

describe('instalarRelatorDeErros', () => {
  function utilidadesFalsas() {
    let atual: (erro: unknown, fatal?: boolean) => void = vi.fn();
    const original = atual;
    const utilidades: ManipuladorGlobal = {
      getGlobalHandler: () => atual,
      setGlobalHandler: (manipulador) => {
        atual = manipulador;
      },
    };
    return {
      utilidades,
      original,
      disparar: (erro: unknown, fatal?: boolean): void => {
        atual(erro, fatal);
      },
    };
  }

  it('relata e devolve o erro ao manipulador de antes', () => {
    const { utilidades, original, disparar } = utilidadesFalsas();
    const relatar = vi.fn();
    instalarRelatorDeErros(relatar, utilidades);

    const erro = new Error('x');
    disparar(erro, true);

    expect(relatar).toHaveBeenCalledWith(erro, true);
    expect(original).toHaveBeenCalledWith(erro, true);
  });

  it('mesmo se o relator estourar, o de antes é chamado', () => {
    const { utilidades, original, disparar } = utilidadesFalsas();
    instalarRelatorDeErros(() => {
      throw new Error('relator quebrado');
    }, utilidades);

    disparar(new Error('x'), false);
    expect(original).toHaveBeenCalled();
  });

  it('desinstalar devolve o manipulador de antes', () => {
    const { utilidades, original } = utilidadesFalsas();
    const desinstalar = instalarRelatorDeErros(vi.fn(), utilidades);
    desinstalar();
    expect(utilidades.getGlobalHandler()).toBe(original);
  });
});

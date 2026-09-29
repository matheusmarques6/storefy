import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ModuloDoAparelho from '@/lib/aparelho-da-previa';

type Modulo = typeof ModuloDoAparelho;

/** Um `localStorage` de mentira, que pode recusar leitura e gravação. */
function armazenamento(opcoes: { inicial?: string; bloqueado?: 'ler' | 'gravar' } = {}) {
  const valores = new Map<string, string>();
  if (opcoes.inicial !== undefined) valores.set('storefy.previa.aparelho', opcoes.inicial);
  return {
    valores,
    getItem(chave: string) {
      if (opcoes.bloqueado === 'ler') throw new Error('SecurityError');
      return valores.get(chave) ?? null;
    },
    setItem(chave: string, valor: string) {
      if (opcoes.bloqueado === 'gravar') throw new Error('QuotaExceededError');
      valores.set(chave, valor);
    },
  };
}

/** O módulo guarda a escolha da visita: cada teste começa de um módulo novo. */
async function carregar(localStorage: ReturnType<typeof armazenamento>): Promise<Modulo> {
  vi.stubGlobal('window', { localStorage });
  vi.resetModules();
  return import('@/lib/aparelho-da-previa');
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('aparelho da prévia', () => {
  it('abre no iPhone quando nada foi escolhido', async () => {
    const modulo = await carregar(armazenamento());
    expect(modulo.aparelhoGuardado()).toBe('iphone');
  });

  it('lembra o Android escolhido numa visita anterior', async () => {
    const modulo = await carregar(armazenamento({ inicial: 'android' }));
    expect(modulo.aparelhoGuardado()).toBe('android');
  });

  it('um valor estranho no navegador volta ao iPhone', async () => {
    const modulo = await carregar(armazenamento({ inicial: 'windows-phone' }));
    expect(modulo.aparelhoGuardado()).toBe('iphone');
  });

  it('com o armazenamento bloqueado, abre no iPhone sem quebrar a tela', async () => {
    const modulo = await carregar(armazenamento({ bloqueado: 'ler' }));
    expect(modulo.aparelhoGuardado()).toBe('iphone');
  });

  it('trocar grava no navegador e avisa quem está desenhando a moldura', async () => {
    const local = armazenamento();
    const modulo = await carregar(local);
    const aoMudar = vi.fn();
    const cancelar = modulo.assinarAparelho(aoMudar);

    modulo.guardarAparelho('android');
    expect(local.valores.get(modulo.CHAVE_DO_APARELHO)).toBe('android');
    expect(modulo.aparelhoGuardado()).toBe('android');
    expect(aoMudar).toHaveBeenCalledTimes(1);

    cancelar();
    modulo.guardarAparelho('iphone');
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it('se o navegador não deixa gravar, a troca vale até fechar a página', async () => {
    const modulo = await carregar(armazenamento({ bloqueado: 'gravar' }));
    modulo.guardarAparelho('android');
    expect(modulo.aparelhoGuardado()).toBe('android');
  });
});

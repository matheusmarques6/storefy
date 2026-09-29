import { describe, expect, it, vi } from 'vitest';
import {
  desligarNotificacoes,
  estadoDasNotificacoes,
  ligarNotificacoes,
  textoDaVersao,
  urlDaPolitica,
  type EntradaDoEstado,
} from './ajustes.ts';

const BASE: EntradaDoEstado = {
  disponivel: true,
  sistemaLido: true,
  sistema: 'concedida',
  inscrito: true,
};

describe('estadoDasNotificacoes', () => {
  it('app sem notificação: a seção nem aparece', () => {
    expect(estadoDasNotificacoes({ ...BASE, disponivel: false })).toBe('indisponivel');
  });

  it('enquanto lê, carregando — e não "desligadas", que seria mentira', () => {
    expect(estadoDasNotificacoes({ ...BASE, sistemaLido: false })).toBe('carregando');
    expect(estadoDasNotificacoes({ ...BASE, inscrito: null })).toBe('carregando');
  });

  it('permissão dada e inscrito: ligadas', () => {
    expect(estadoDasNotificacoes(BASE)).toBe('ligadas');
  });

  it('desligou no app: desligadas, mesmo com a permissão do sistema', () => {
    expect(estadoDasNotificacoes({ ...BASE, inscrito: false })).toBe('desligadas');
  });

  it('nunca perguntado: desligadas, e a chave pergunta', () => {
    expect(estadoDasNotificacoes({ ...BASE, sistema: 'nao-perguntado', inscrito: false })).toBe(
      'desligadas',
    );
  });

  it('recusado no sistema: bloqueadas, já sem esperar a inscrição', () => {
    expect(estadoDasNotificacoes({ ...BASE, sistema: 'negada', inscrito: null })).toBe(
      'bloqueadas',
    );
  });
});

describe('ligarNotificacoes', () => {
  function sdk(podePedir = true) {
    return { ligar: vi.fn(), podePedir: vi.fn(() => Promise.resolve(podePedir)) };
  }

  it('com a permissão dada, só volta a inscrever', async () => {
    const notificador = sdk();
    const pedir = vi.fn(() => Promise.resolve(true));
    await expect(ligarNotificacoes(notificador, 'concedida', pedir)).resolves.toBe('ligadas');
    expect(pedir).not.toHaveBeenCalled();
    expect(notificador.ligar).toHaveBeenCalledOnce();
  });

  it('sem permissão ainda, pede ao sistema antes', async () => {
    const notificador = sdk();
    await expect(
      ligarNotificacoes(notificador, 'nao-perguntado', () => Promise.resolve(true)),
    ).resolves.toBe('ligadas');
    expect(notificador.ligar).toHaveBeenCalledOnce();
  });

  it('recusou no alerta e o sistema não pergunta de novo: bloqueadas', async () => {
    const notificador = sdk(false);
    await expect(
      ligarNotificacoes(notificador, 'nao-perguntado', () => Promise.resolve(false)),
    ).resolves.toBe('bloqueadas');
    expect(notificador.ligar).not.toHaveBeenCalled();
  });

  it('recusou, mas o sistema ainda deixa perguntar: desligadas', async () => {
    await expect(
      ligarNotificacoes(sdk(true), 'nao-perguntado', () => Promise.resolve(false)),
    ).resolves.toBe('desligadas');
  });

  it('já bloqueadas: nem tenta, o caminho é o dos ajustes do celular', async () => {
    const pedir = vi.fn(() => Promise.resolve(true));
    await expect(ligarNotificacoes(sdk(), 'negada', pedir)).resolves.toBe('bloqueadas');
    expect(pedir).not.toHaveBeenCalled();
  });
});

describe('desligarNotificacoes', () => {
  it('desliga a inscrição, e só ela', () => {
    const notificador = { desligar: vi.fn() };
    expect(desligarNotificacoes(notificador)).toBe('desligadas');
    expect(notificador.desligar).toHaveBeenCalledOnce();
  });
});

describe('textoDaVersao e urlDaPolitica', () => {
  it('a versão com o build, como o suporte pergunta', () => {
    expect(textoDaVersao('1.2.0', 12)).toBe('Versão 1.2.0 (12)');
  });

  it('a política pelo id do app, sem barra dupla', () => {
    expect(
      urlDaPolitica({
        apiBase: 'https://app.storefy.com.br/',
        appId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toBe('https://app.storefy.com.br/privacy/app/11111111-1111-4111-8111-111111111111');
  });

  it('sem credencial, sem link', () => {
    expect(urlDaPolitica(null)).toBeNull();
  });
});

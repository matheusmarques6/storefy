import { describe, expect, it, vi } from 'vitest';
import {
  codigoDoPareamento,
  mensagemDoPareamento,
  parearEsteCelular,
  type DependenciasDoPareamento,
} from './pareamento.ts';

const CREDENCIAIS = {
  apiBase: 'https://storefy.convertfy.me',
  appId: '11111111-1111-4111-8111-111111111111',
  segredo: 'segredo',
};
const INSTALACAO = '3f6c1a2e-8d4b-4c7a-9e10-5b2f8a7c6d41';

describe('codigoDoPareamento', () => {
  it('lê o código do link do app, nas duas formas do esquema', () => {
    expect(codigoDoPareamento('storefy-abc://celular-de-teste?codigo=ABCD2345')).toBe('ABCD2345');
    expect(codigoDoPareamento('storefy-abc:///celular-de-teste?codigo=abcd2345')).toBe('ABCD2345');
  });

  it('link da loja, outro caminho ou código fora do formato não é pareamento', () => {
    for (const url of [
      'https://loja.com.br/celular-de-teste?codigo=ABCD2345',
      'storefy-abc://products/jaqueta',
      'storefy-abc://celular-de-teste',
      'storefy-abc://celular-de-teste?codigo=ABCD0123',
      'storefy-abc://celular-de-teste?codigo=CURTO',
      'não é link',
    ]) {
      expect(codigoDoPareamento(url), url).toBeNull();
    }
  });
});

function dependencias(extra: Partial<DependenciasDoPareamento> = {}): DependenciasDoPareamento {
  return {
    credenciais: CREDENCIAIS,
    instalacao: () => Promise.resolve(INSTALACAO),
    inscricao: () => Promise.resolve('sub-1'),
    registrar: vi.fn(() => Promise.resolve({ ok: true as const, dados: {} })),
    parear: vi.fn(() => Promise.resolve({ ok: true as const, dados: { resultado: 'pareado' } })),
    ...extra,
  };
}

describe('parearEsteCelular', () => {
  /* O link pode ter aberto o app pela primeira vez: sem registro, não há o que parear. */
  it('registra o celular e depois pareia, com a instalação e a inscrição', async () => {
    const dep = dependencias();
    await expect(parearEsteCelular('ABCD2345', dep)).resolves.toBe('pareado');
    expect(dep.registrar).toHaveBeenCalledWith({ installId: INSTALACAO, subscriptionId: 'sub-1' });
    expect(dep.parear).toHaveBeenCalledWith({
      codigo: 'ABCD2345',
      installId: INSTALACAO,
      subscriptionId: 'sub-1',
    });
  });

  it('sem push, pareia só pela instalação', async () => {
    const dep = dependencias({ inscricao: () => Promise.resolve(null) });
    await expect(parearEsteCelular('ABCD2345', dep)).resolves.toBe('pareado');
    expect(dep.parear).toHaveBeenCalledWith({ codigo: 'ABCD2345', installId: INSTALACAO });
  });

  it('o que o servidor diz do código chega à tela', async () => {
    for (const resultado of ['codigo_invalido', 'aparelho_desconhecido'] as const) {
      const dep = dependencias({
        parear: () => Promise.resolve({ ok: true as const, dados: { resultado } }),
      });
      await expect(parearEsteCelular('ABCD2345', dep)).resolves.toBe(resultado);
    }
  });

  it('rede, limite, falta de credencial e de identidade viram resultado, e não exceção', async () => {
    await expect(
      parearEsteCelular(
        'ABCD2345',
        dependencias({ registrar: () => Promise.resolve({ ok: false, motivo: 'rede' }) }),
      ),
    ).resolves.toBe('sem_rede');
    await expect(
      parearEsteCelular(
        'ABCD2345',
        dependencias({
          parear: () => Promise.resolve({ ok: false, motivo: 'limite', status: 429 }),
        }),
      ),
    ).resolves.toBe('limitado');
    await expect(parearEsteCelular('ABCD2345', dependencias({ credenciais: null }))).resolves.toBe(
      'sem_credencial',
    );
    // A Storefy recusou a assinatura: é o app que está velho, e não a internet.
    await expect(
      parearEsteCelular(
        'ABCD2345',
        dependencias({
          parear: () => Promise.resolve({ ok: false, motivo: 'recusado', status: 401 }),
        }),
      ),
    ).resolves.toBe('sem_credencial');
    await expect(
      parearEsteCelular(
        'ABCD2345',
        dependencias({
          registrar: () => Promise.resolve({ ok: false, motivo: 'servidor', status: 503 }),
        }),
      ),
    ).resolves.toBe('sem_rede');
    await expect(
      parearEsteCelular(
        'ABCD2345',
        dependencias({
          instalacao: () => Promise.reject(new Error('disco')),
          inscricao: () => Promise.resolve(null),
        }),
      ),
    ).resolves.toBe('aparelho_desconhecido');
  });
});

describe('mensagemDoPareamento', () => {
  it('cada resultado diz o que fazer, em português de quem vende', () => {
    expect(mensagemDoPareamento('pareado')).toMatchObject({ ok: true, titulo: 'Pronto!' });
    expect(mensagemDoPareamento('codigo_invalido').texto).toContain('Gere outro no painel');
    expect(mensagemDoPareamento('sem_rede').ok).toBe(false);
  });
});

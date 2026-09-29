import { afterEach, describe, expect, it, vi } from 'vitest';
import { descreverErro, limpar, log, montarLinha } from '@/lib/log';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('montarLinha', () => {
  it('uma linha de JSON com nível, evento e hora', () => {
    const linha = montarLinha(
      'aviso',
      'webhook-shopify.assinatura-invalida',
      { loja: 'x.myshopify.com' },
      new Date('2026-09-29T12:00:00Z'),
    );
    expect(linha).not.toContain('\n');
    expect(JSON.parse(linha)).toEqual({
      loja: 'x.myshopify.com',
      nivel: 'aviso',
      evento: 'webhook-shopify.assinatura-invalida',
      em: '2026-09-29T12:00:00.000Z',
    });
  });

  it('um campo de mesmo nome nos dados não disfarça o nível', () => {
    const linha = JSON.parse(montarLinha('erro', 'x', { nivel: 'info', evento: 'outro' })) as {
      nivel: string;
      evento: string;
    };
    expect(linha.nivel).toBe('erro');
    expect(linha.evento).toBe('x');
  });
});

describe('limpar: nada sensível sai no log', () => {
  it('esconde segredo em qualquer profundidade', () => {
    const limpo = limpar({
      token: 'shpat_abc',
      resposta: {
        corpo: { access_token: 'shpat_abc', client_secret: 'xyz', ok: true },
        headers: { Authorization: 'Bearer abc', cookie: 'sb=1' },
      },
      shopify_access_token_enc: 'cifrado',
      senha: '123',
      chave: 'k',
      apiKey: 'k',
      dsn: 'https://k@sentry.io/1',
      assinatura: 'hmac',
    });
    const texto = JSON.stringify(limpo);
    for (const segredo of ['shpat_abc', 'xyz', 'Bearer', 'sb=1', 'cifrado', '123', 'hmac']) {
      expect(texto, segredo).not.toContain(segredo);
    }
    expect(texto).toContain('"ok":true');
  });

  it('corta texto longo e lista comprida', () => {
    const limpo = limpar({
      corpo: 'a'.repeat(5000),
      itens: Array.from({ length: 100 }, (_, i) => i),
    });
    const { corpo, itens } = limpo as { corpo: string; itens: number[] };
    expect(corpo.length).toBeLessThanOrEqual(1001);
    expect(itens).toHaveLength(20);
  });

  it('não entra em laço num objeto muito fundo', () => {
    const fundo: Record<string, unknown> = {};
    let atual = fundo;
    for (let i = 0; i < 10; i++) {
      const proximo: Record<string, unknown> = {};
      atual.dentro = proximo;
      atual = proximo;
    }
    expect(JSON.stringify(limpar(fundo))).toContain('[…]');
  });

  it('erro vira dado, com a pilha curta e o digest do Next', () => {
    const erro = Object.assign(new Error('quebrou'), { digest: '123' });
    const descrito = descreverErro(erro);
    expect(descrito).toMatchObject({ nome: 'Error', mensagem: 'quebrou', digest: '123' });
    expect(Array.isArray(descrito.pilha)).toBe(true);
    expect(descreverErro('texto')).toEqual({ mensagem: 'texto' });
  });
});

describe('log', () => {
  it('cada nível no canal certo do console', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    log.info('a');
    log.aviso('b');
    log.erro('c', { erro: new Error('x') });

    expect(info).toHaveBeenCalledOnce();
    expect(aviso).toHaveBeenCalledOnce();
    expect(erro).toHaveBeenCalledOnce();
    const linha = JSON.parse(String(erro.mock.calls[0]?.[0])) as { erro: { mensagem: string } };
    expect(linha.erro.mensagem).toBe('x');
  });
});

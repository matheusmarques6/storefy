import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  escreverMensagemParaWeb,
  injecaoDeMensagem,
  lerMensagemDaWeb,
  type NativeToWeb,
  type WebToNative,
} from './mensagens';

/**
 * O código é sintaticamente válido?
 *
 * `new Script` do `node:vm` compila sem executar, então verifica a sintaxe sem
 * rodar nada — ao contrário de `new Function`, que constrói uma função
 * executável e é `no-implied-eval` com razão.
 */
function compila(codigo: string): void {
  new Script(codigo);
}

function comoPostMessage(objeto: unknown): string {
  return JSON.stringify(objeto);
}

describe('lerMensagemDaWeb — mensagens válidas', () => {
  it('aceita CART_UPDATED', () => {
    const resultado = lerMensagemDaWeb(
      comoPostMessage({
        type: 'CART_UPDATED',
        count: 2,
        token: 'abc123',
        totalCents: 19990,
        currency: 'BRL',
      }),
    );
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.mensagem.type).toBe('CART_UPDATED');
  });

  it('aceita carrinho esvaziado', () => {
    const resultado = lerMensagemDaWeb(
      comoPostMessage({
        type: 'CART_UPDATED',
        count: 0,
        token: 'abc',
        totalCents: 0,
        currency: 'BRL',
      }),
    );
    expect(resultado.ok).toBe(true);
  });

  it('aceita CUSTOMER_IDENTIFIED sem nenhum identificador', () => {
    // A loja pode sinalizar que houve login sem revelar quem é.
    expect(lerMensagemDaWeb(comoPostMessage({ type: 'CUSTOMER_IDENTIFIED' })).ok).toBe(true);
  });

  it('aceita as demais do contrato', () => {
    const mensagens: WebToNative[] = [
      { type: 'CHECKOUT_STARTED', token: 'tok' },
      { type: 'ORDER_COMPLETED', orderId: '1001', totalCents: 5000 },
      { type: 'HAPTIC', style: 'success' },
      { type: 'SHARE', url: 'https://minha-loja.com.br/p/1' },
      { type: 'REQUEST_PUSH_PERMISSION' },
      { type: 'OPEN_EXTERNAL', url: 'https://instagram.com/loja' },
    ];
    for (const mensagem of mensagens) {
      expect(lerMensagemDaWeb(comoPostMessage(mensagem)).ok, mensagem.type).toBe(true);
    }
  });
});

describe('lerMensagemDaWeb — recusa entrada hostil ou quebrada', () => {
  // Tudo aqui pode chegar: a página é do lojista e roda tema, apps e scripts
  // de terceiros, todos capazes de chamar postMessage com o que quiserem.

  it('recusa o que não é texto', () => {
    for (const valor of [null, undefined, 42, {}, []]) {
      expect(lerMensagemDaWeb(valor).ok).toBe(false);
    }
  });

  it('recusa JSON inválido sem lançar', () => {
    const resultado = lerMensagemDaWeb('{isto não é json');
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.motivo).toContain('JSON');
  });

  it('recusa mensagem grande demais', () => {
    // Um script hostil mandando megabytes travaria a thread de JS só no parse.
    const gigante = comoPostMessage({ type: 'SHARE', url: `https://x.com/${'a'.repeat(70_000)}` });
    const resultado = lerMensagemDaWeb(gigante);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.motivo).toContain('grande');
  });

  it('recusa tipo desconhecido', () => {
    expect(lerMensagemDaWeb(comoPostMessage({ type: 'EXECUTAR_QUALQUER_COISA' })).ok).toBe(false);
  });

  it('recusa campo obrigatório ausente', () => {
    expect(lerMensagemDaWeb(comoPostMessage({ type: 'CART_UPDATED', count: 1 })).ok).toBe(false);
  });

  it('recusa quantidade negativa e valor fracionado', () => {
    const base = { type: 'CART_UPDATED', token: 'a', currency: 'BRL' };
    expect(lerMensagemDaWeb(comoPostMessage({ ...base, count: -1, totalCents: 0 })).ok).toBe(false);
    expect(lerMensagemDaWeb(comoPostMessage({ ...base, count: 1, totalCents: 10.5 })).ok).toBe(
      false,
    );
  });

  it('recusa moeda fora do padrão ISO', () => {
    const base = { type: 'CART_UPDATED', count: 1, token: 'a', totalCents: 1 };
    expect(lerMensagemDaWeb(comoPostMessage({ ...base, currency: 'REAIS' })).ok).toBe(false);
  });

  it('recusa esquema perigoso em SHARE e OPEN_EXTERNAL', () => {
    // `z.url()` sozinho aceitaria todos estes: pela especificação são URLs
    // válidas. Só que iriam direto para `Linking.openURL`, e `intent://` no
    // Android dispara activity arbitrária.
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'intent://evil#Intent;scheme=http;end',
      'file:///etc/passwd',
      '/relativo',
      'nao-e-url',
    ]) {
      expect(lerMensagemDaWeb(comoPostMessage({ type: 'SHARE', url })).ok, url).toBe(false);
      expect(lerMensagemDaWeb(comoPostMessage({ type: 'OPEN_EXTERNAL', url })).ok, url).toBe(false);
    }
  });

  it('aceita http e https', () => {
    for (const url of ['https://minha-loja.com.br/p/1', 'http://minha-loja.com.br/p/1']) {
      expect(lerMensagemDaWeb(comoPostMessage({ type: 'OPEN_EXTERNAL', url })).ok, url).toBe(true);
    }
  });

  it('recusa estilo de haptic fora do contrato', () => {
    expect(lerMensagemDaWeb(comoPostMessage({ type: 'HAPTIC', style: 'explosao' })).ok).toBe(false);
  });

  it('diz onde está o problema', () => {
    const resultado = lerMensagemDaWeb(
      comoPostMessage({
        type: 'CART_UPDATED',
        count: 1,
        token: '',
        totalCents: 1,
        currency: 'BRL',
      }),
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.motivo).toContain('token');
  });
});

describe('mensagens do app para a página', () => {
  it('serializa APP_CONTEXT e NAVIGATE', () => {
    const mensagens: NativeToWeb[] = [
      { type: 'APP_CONTEXT', platform: 'android', appVersion: '2.1.0', pushEnabled: false },
      { type: 'NAVIGATE', path: '/colecoes/promo' },
    ];
    for (const mensagem of mensagens) {
      expect(JSON.parse(escreverMensagemParaWeb(mensagem))).toEqual(mensagem);
    }
  });

  it('recusa NAVIGATE com caminho absoluto', () => {
    // Um caminho absoluto abriria outro site dentro da aba da loja.
    expect(() =>
      escreverMensagemParaWeb({
        type: 'NAVIGATE',
        // Caminho absoluto abriria outro site dentro da aba da loja.
        path: 'https://outro-site.com',
      }),
    ).toThrow();
  });

  it('a injeção é JavaScript válido e termina em true;', () => {
    const script = injecaoDeMensagem({ type: 'NAVIGATE', path: '/carrinho' });
    expect(script.endsWith('true;')).toBe(true);
    expect(() => {
      compila(script);
    }).not.toThrow();
  });
});

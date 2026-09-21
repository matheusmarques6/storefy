import { describe, expect, it } from 'vitest';
import { acaoParaMensagem, type ContextoDasAcoes } from './acoes';

/** Build da Fase 1: sem OneSignal e sem backend de eventos. */
const FASE_1: ContextoDasAcoes = { push: false, eventos: false, pedirAvaliacao: true };
/** Build completo, como fica no fim da Fase 3. */
const COMPLETO: ContextoDasAcoes = { push: true, eventos: true, pedirAvaliacao: true };

function comoPostMessage(objeto: unknown): string {
  return JSON.stringify(objeto);
}

describe('acaoParaMensagem — o que sempre funciona', () => {
  it('leva o carrinho para o badge, com ou sem os campos opcionais', () => {
    expect(
      acaoParaMensagem(
        comoPostMessage({
          type: 'CART_UPDATED',
          count: 2,
          token: 'abc',
          totalCents: 9900,
          currency: 'BRL',
        }),
        FASE_1,
      ),
    ).toEqual({ tipo: 'carrinho', count: 2, token: 'abc', totalCents: 9900, currency: 'BRL' });

    expect(acaoParaMensagem(comoPostMessage({ type: 'CART_UPDATED', count: 0 }), FASE_1)).toEqual({
      tipo: 'carrinho',
      count: 0,
      token: undefined,
      totalCents: undefined,
      currency: undefined,
    });
  });

  it('vibra, compartilha e abre fora sem depender de backend', () => {
    expect(acaoParaMensagem(comoPostMessage({ type: 'HAPTIC', style: 'success' }), FASE_1)).toEqual(
      {
        tipo: 'vibrar',
        estilo: 'success',
      },
    );

    expect(
      acaoParaMensagem(
        comoPostMessage({ type: 'SHARE', url: 'https://oakvintage.com.br/p/1', title: 'Jaqueta' }),
        FASE_1,
      ),
    ).toEqual({ tipo: 'compartilhar', url: 'https://oakvintage.com.br/p/1', title: 'Jaqueta' });

    expect(
      acaoParaMensagem(
        comoPostMessage({ type: 'OPEN_EXTERNAL', url: 'https://instagram.com/oakvintage' }),
        FASE_1,
      ),
    ).toEqual({ tipo: 'abrir-fora', url: 'https://instagram.com/oakvintage' });
  });

  it('pede avaliação depois da compra, que é recurso local', () => {
    expect(
      acaoParaMensagem(
        comoPostMessage({ type: 'ORDER_COMPLETED', orderId: '1001', totalCents: 15000 }),
        FASE_1,
      ),
    ).toEqual({
      tipo: 'pedido-concluido',
      orderId: '1001',
      totalCents: 15000,
      pedirAvaliacao: true,
    });
  });

  it('respeita rateAppPrompt desligado na config', () => {
    const acao = acaoParaMensagem(
      comoPostMessage({ type: 'ORDER_COMPLETED', orderId: '1001', totalCents: 1 }),
      { ...COMPLETO, pedirAvaliacao: false },
    );
    expect(acao).toEqual({
      tipo: 'pedido-concluido',
      orderId: '1001',
      totalCents: 1,
      pedirAvaliacao: false,
    });
  });
});

describe('acaoParaMensagem — recurso que este build não tem', () => {
  it('NÃO pede permissão de push sem OneSignal configurado', () => {
    // No iOS o sistema mostra o pedido uma vez só. Disparar sem ter para onde
    // registrar o aparelho queima a única chance, e em silêncio.
    const acao = acaoParaMensagem(comoPostMessage({ type: 'REQUEST_PUSH_PERMISSION' }), FASE_1);
    expect(acao).toEqual({ tipo: 'ignorar', motivo: 'Push ainda não configurado neste app.' });

    expect(
      acaoParaMensagem(comoPostMessage({ type: 'REQUEST_PUSH_PERMISSION' }), COMPLETO),
    ).toEqual({ tipo: 'pedir-push' });
  });

  /*
   * O pedido de aviso depende do PUSH, e não do backend de eventos: aceitar a
   * inscrição num app sem push registraria a intenção de alguém que nunca
   * receberia o aviso, e o silêncio depois seria pior do que o botão não
   * existir.
   */
  it('só aceita o "me avise" quando há como notificar', () => {
    const mensagem = comoPostMessage({
      type: 'NOTIFY_WHEN_BACK',
      variantId: '4412345',
      path: '/products/jaqueta?variant=4412345',
    });

    expect(acaoParaMensagem(mensagem, FASE_1)).toEqual({
      tipo: 'ignorar',
      motivo: 'Push ainda não configurado neste app.',
    });
    expect(acaoParaMensagem(mensagem, COMPLETO)).toEqual({
      tipo: 'avisar-de-volta',
      variantId: '4412345',
      path: '/products/jaqueta?variant=4412345',
    });
  });

  it('e o "me avise" sem caminho continua valendo: a variante basta', () => {
    expect(
      acaoParaMensagem(comoPostMessage({ type: 'NOTIFY_WHEN_BACK', variantId: '44' }), COMPLETO),
    ).toEqual({ tipo: 'avisar-de-volta', variantId: '44', path: undefined });
  });

  it('segura a identificação do cliente até existir para onde mandar', () => {
    const mensagem = comoPostMessage({ type: 'CUSTOMER_IDENTIFIED', customerId: '42' });
    expect(acaoParaMensagem(mensagem, FASE_1)).toEqual({
      tipo: 'ignorar',
      motivo: 'Push ainda não configurado neste app.',
    });
    expect(acaoParaMensagem(mensagem, COMPLETO)).toEqual({
      tipo: 'identificar-cliente',
      customerId: '42',
      emailHash: undefined,
    });
  });

  it('segura o início de checkout até existir cart_events', () => {
    const mensagem = comoPostMessage({ type: 'CHECKOUT_STARTED', token: 'ck-1' });
    expect(acaoParaMensagem(mensagem, FASE_1)).toEqual({
      tipo: 'ignorar',
      motivo: 'Eventos de carrinho ainda não configurados.',
    });
    expect(acaoParaMensagem(mensagem, COMPLETO)).toEqual({
      tipo: 'checkout-iniciado',
      token: 'ck-1',
    });
  });

  it('todo motivo de ignorar é uma frase, nunca vazio', () => {
    const casos: unknown[] = [
      comoPostMessage({ type: 'REQUEST_PUSH_PERMISSION' }),
      comoPostMessage({ type: 'CHECKOUT_STARTED', token: 'x' }),
      comoPostMessage({ type: 'QUALQUER_COISA' }),
      'não é json',
      null,
      42,
    ];
    for (const caso of casos) {
      const acao = acaoParaMensagem(caso, FASE_1);
      expect(acao.tipo).toBe('ignorar');
      if (acao.tipo === 'ignorar') expect(acao.motivo.length).toBeGreaterThan(5);
    }
  });
});

describe('acaoParaMensagem — página hostil', () => {
  it('ignora mensagem que não passa no contrato', () => {
    const invalidas = [
      { type: 'CART_UPDATED' },
      { type: 'CART_UPDATED', count: -1 },
      { type: 'HAPTIC', style: 'explodir' },
      { type: 'SHARE', url: 'javascript:alert(1)' },
      { type: 'OPEN_EXTERNAL', url: 'intent://evil#Intent;end' },
      { type: 'ORDER_COMPLETED', orderId: '', totalCents: 1 },
      { tipo: 'CART_UPDATED', count: 1 },
      [],
    ];
    for (const invalida of invalidas) {
      expect(acaoParaMensagem(comoPostMessage(invalida), COMPLETO).tipo).toBe('ignorar');
    }
  });

  it('ignora entrada que nem string é', () => {
    for (const entrada of [undefined, null, 0, {}, [], true]) {
      expect(acaoParaMensagem(entrada, COMPLETO).tipo).toBe('ignorar');
    }
  });

  it('nunca deixa uma URL fora de http(s) virar ação', () => {
    // `SHARE` e `OPEN_EXTERNAL` terminam em `Linking.openURL`. `intent://` no
    // Android dispara activity arbitrária, e `javascript:` volta para a página.
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'intent://scan/#Intent;scheme=zxing;end',
      'file:///etc/passwd',
    ]) {
      expect(acaoParaMensagem(comoPostMessage({ type: 'SHARE', url }), COMPLETO).tipo).toBe(
        'ignorar',
      );
      expect(acaoParaMensagem(comoPostMessage({ type: 'OPEN_EXTERNAL', url }), COMPLETO).tipo).toBe(
        'ignorar',
      );
    }
  });
});

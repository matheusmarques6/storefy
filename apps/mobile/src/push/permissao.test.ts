import { describe, expect, it } from 'vitest';
import {
  ESPERA_APOS_RECUSA_MS,
  HISTORICO_VAZIO,
  MAXIMO_DE_RECUSAS,
  decidirPermissao,
  lerHistorico,
  registrarRecusa,
  type EstadoDaPermissao,
} from './permissao.ts';

const AGORA = 1_800_000_000_000;

const BASE: EstadoDaPermissao = {
  sistema: 'nao-perguntado',
  historico: HISTORICO_VAZIO,
  aberturas: 3,
  gatilho: 'abertura',
  agoraMs: AGORA,
  disponivel: true,
  momento: 'onboarding',
};

describe('decidirPermissao', () => {
  it('mostra o pré-prompt a partir da segunda abertura', () => {
    expect(decidirPermissao(BASE).acao).toBe('pre-prompt');
    expect(decidirPermissao({ ...BASE, aberturas: 2 }).acao).toBe('pre-prompt');
  });

  /*
   * Na primeira abertura o cliente ainda não viu a loja. A pergunta chega como
   * cobrança, e o "não permitir" do iOS é para sempre.
   */
  it('não pergunta na primeira abertura', () => {
    expect(decidirPermissao({ ...BASE, aberturas: 1 }).acao).toBe('nada');
  });

  it('pergunta no carrinho mesmo na primeira abertura', () => {
    // É o melhor momento que existe: ele quer aquele produto agora.
    expect(decidirPermissao({ ...BASE, aberturas: 1, gatilho: 'carrinho' }).acao).toBe(
      'pre-prompt',
    );
  });

  /*
   * O cliente clicou em "me avise" na loja. Um pré-prompt aqui seria um toque
   * a mais para ele repetir o que acabou de dizer.
   */
  it('vai direto ao sistema quando a página pede', () => {
    expect(decidirPermissao({ ...BASE, gatilho: 'pedido-da-pagina' }).acao).toBe(
      'pedir-ao-sistema',
    );
    expect(decidirPermissao({ ...BASE, aberturas: 1, gatilho: 'pedido-da-pagina' }).acao).toBe(
      'pedir-ao-sistema',
    );
  });

  it('não pergunta a quem já aceitou', () => {
    expect(decidirPermissao({ ...BASE, sistema: 'concedida' }).acao).toBe('nada');
    expect(
      decidirPermissao({ ...BASE, sistema: 'concedida', gatilho: 'pedido-da-pagina' }).acao,
    ).toBe('nada');
  });

  /*
   * Recusado no sistema, o pedido do iOS não mostra mais nada. Chamá-lo
   * pareceria funcionar e não faria absolutamente nada — a saída é a tela de
   * ajustes do app.
   */
  it('não insiste com quem recusou no sistema, nem a pedido da página', () => {
    expect(decidirPermissao({ ...BASE, sistema: 'negada' }).acao).toBe('nada');
    expect(decidirPermissao({ ...BASE, sistema: 'negada', gatilho: 'pedido-da-pagina' }).acao).toBe(
      'nada',
    );
    expect(decidirPermissao({ ...BASE, sistema: 'negada', gatilho: 'carrinho' }).acao).toBe('nada');
  });

  it('não pergunta quando o push não existe neste build', () => {
    expect(decidirPermissao({ ...BASE, disponivel: false }).acao).toBe('nada');
    expect(decidirPermissao({ ...BASE, disponivel: false, gatilho: 'pedido-da-pagina' }).acao).toBe(
      'nada',
    );
  });

  describe('depois de um "agora não"', () => {
    const recusouAgora = {
      ...BASE,
      historico: { recusas: 1, ultimaRecusaMs: AGORA - 1000 },
    };

    it('espera uma semana antes de voltar a perguntar', () => {
      expect(decidirPermissao(recusouAgora).acao).toBe('nada');
      expect(
        decidirPermissao({
          ...recusouAgora,
          agoraMs: AGORA + ESPERA_APOS_RECUSA_MS,
        }).acao,
      ).toBe('pre-prompt');
    });

    it('a espera vale até no carrinho', () => {
      expect(decidirPermissao({ ...recusouAgora, gatilho: 'carrinho' }).acao).toBe('nada');
    });

    it('mas um pedido da própria página passa por cima da espera', () => {
      // Ele clicou agora, no botão da loja. Ignorar isso seria um botão que
      // não faz nada.
      expect(decidirPermissao({ ...recusouAgora, gatilho: 'pedido-da-pagina' }).acao).toBe(
        'pedir-ao-sistema',
      );
    });

    it('desiste depois de três recusas', () => {
      const cansado = {
        ...BASE,
        historico: {
          recusas: MAXIMO_DE_RECUSAS,
          ultimaRecusaMs: AGORA - ESPERA_APOS_RECUSA_MS * 10,
        },
      };
      expect(decidirPermissao(cansado).acao).toBe('nada');
      expect(decidirPermissao({ ...cansado, gatilho: 'carrinho' }).acao).toBe('nada');
    });

    it('na terceira recusa ainda pergunta; é a quarta que não acontece', () => {
      const duas = {
        ...BASE,
        historico: {
          recusas: MAXIMO_DE_RECUSAS - 1,
          ultimaRecusaMs: AGORA - ESPERA_APOS_RECUSA_MS * 2,
        },
      };
      expect(decidirPermissao(duas).acao).toBe('pre-prompt');
    });
  });
});

describe('o momento escolhido pelo lojista', () => {
  /*
   * `features.pushPromptTiming` é escolha do lojista, e o app não tem direito
   * de passar por cima dela: o pedido do iOS só existe uma vez, e gastá-lo num
   * momento que o lojista decidiu que não era o certo não tem volta.
   */
  it('com `manual`, o app NUNCA pergunta por conta própria', () => {
    const manual = { ...BASE, momento: 'manual' as const };
    expect(decidirPermissao(manual).acao).toBe('nada');
    expect(decidirPermissao({ ...manual, gatilho: 'carrinho' }).acao).toBe('nada');
    expect(decidirPermissao({ ...manual, aberturas: 50 }).acao).toBe('nada');
  });

  it('com `manual`, o botão da própria loja continua funcionando', () => {
    // Senão seria um botão que não faz nada, que é o que a regra 3 proíbe.
    expect(decidirPermissao({ ...BASE, momento: 'manual', gatilho: 'pedido-da-pagina' }).acao).toBe(
      'pedir-ao-sistema',
    );
  });

  it('com `after_first_add_to_cart`, a abertura não pergunta', () => {
    const depois = { ...BASE, momento: 'after_first_add_to_cart' as const };
    expect(decidirPermissao(depois).acao).toBe('nada');
    expect(decidirPermissao({ ...depois, aberturas: 50 }).acao).toBe('nada');
  });

  it('com `after_first_add_to_cart`, o carrinho pergunta', () => {
    expect(
      decidirPermissao({
        ...BASE,
        momento: 'after_first_add_to_cart',
        aberturas: 1,
        gatilho: 'carrinho',
      }).acao,
    ).toBe('pre-prompt');
  });

  it('com `onboarding`, o carrinho também serve', () => {
    expect(decidirPermissao({ ...BASE, aberturas: 1, gatilho: 'carrinho' }).acao).toBe(
      'pre-prompt',
    );
  });
});

describe('registrarRecusa', () => {
  it('soma uma recusa e guarda quando foi', () => {
    expect(registrarRecusa(HISTORICO_VAZIO, AGORA)).toEqual({
      recusas: 1,
      ultimaRecusaMs: AGORA,
    });
    expect(registrarRecusa({ recusas: 2, ultimaRecusaMs: 1 }, AGORA)).toEqual({
      recusas: 3,
      ultimaRecusaMs: AGORA,
    });
  });
});

describe('lerHistorico', () => {
  it('lê o que foi guardado', () => {
    expect(lerHistorico(JSON.stringify({ recusas: 2, ultimaRecusaMs: AGORA }))).toEqual({
      recusas: 2,
      ultimaRecusaMs: AGORA,
    });
  });

  /*
   * O que está no disco foi escrito por uma versão anterior do app. Um parse
   * que lance aqui impede o app de ABRIR — muito pior do que perder a conta
   * de quantas vezes já perguntamos.
   */
  it('aguenta qualquer lixo sem lançar', () => {
    for (const bruto of [
      null,
      '',
      '   ',
      'não é json',
      'null',
      '42',
      '"texto"',
      '[]',
      '{}',
      '{"recusas":"duas"}',
      '{"recusas":-1}',
      '{"recusas":1.5}',
      '{"ultimaRecusaMs":"ontem"}',
      '{"ultimaRecusaMs":-5}',
    ]) {
      const lido = lerHistorico(bruto);
      expect(lido.recusas).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(lido.recusas)).toBe(true);
      expect(lido.ultimaRecusaMs === null || lido.ultimaRecusaMs > 0).toBe(true);
    }
  });

  it('um histórico corrompido não vira "já perguntamos demais"', () => {
    // Se o lixo virasse `recusas: Infinity`, o cliente nunca mais seria
    // perguntado — e ninguém descobriria.
    expect(lerHistorico('{"recusas":1e999}').recusas).toBe(0);
  });
});

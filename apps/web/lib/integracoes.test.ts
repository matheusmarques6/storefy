import { describe, expect, it } from 'vitest';
import {
  AVISOS_DA_SHOPIFY,
  avisoDaShopify,
  conferirDominioDigitado,
  rotuloDoEscopo,
  situacaoDaShopify,
} from '@/lib/integracoes';

const PEDIDOS = 'read_products,read_orders,read_customers,read_fulfillments';

function dados(ajustes: Partial<Parameters<typeof situacaoDaShopify>[0]> = {}) {
  return {
    configurado: true,
    temLoja: true,
    shopDomain: 'minha-loja.myshopify.com',
    escopos: PEDIDOS.split(','),
    escoposPedidos: PEDIDOS,
    caminho: 'oauth' as const,
    clientId: null,
    ...ajustes,
  };
}

describe('situacaoDaShopify', () => {
  it('conectada quando o token existe e os escopos cobrem o pedido', () => {
    const situacao = situacaoDaShopify(dados());

    expect(situacao.estado).toBe('conectada');
    expect(situacao.faltando).toEqual([]);
    expect(situacao.dominio).toBe('minha-loja.myshopify.com');
  });

  /*
   * O app público da Storefy deixou de ser condição para a tela funcionar: o
   * caminho do app da própria loja não depende dele. Sem OAuth, a loja não
   * fica "em preparação" — ela fica conectável por um caminho só, e o estado
   * continua dizendo a verdade sobre a conexão.
   */
  it('sem o app público, a loja ainda conecta pelo caminho manual', () => {
    const situacao = situacaoDaShopify(dados({ configurado: false }));

    expect(situacao.estado).toBe('conectada');
    expect(situacao.oauthDisponivel).toBe(false);
  });

  it('sem loja continua sendo o que falta, mesmo sem o app público', () => {
    expect(situacaoDaShopify(dados({ configurado: false, temLoja: false })).estado).toBe(
      'sem_loja',
    );
  });

  it('conta por qual caminho a loja conectou', () => {
    const manual = situacaoDaShopify(dados({ caminho: 'manual', clientId: 'abc123' }));

    expect(manual.caminho).toBe('manual');
    expect(manual.clientId).toBe('abc123');
  });

  it('sem loja não há o que conectar', () => {
    expect(situacaoDaShopify(dados({ temLoja: false })).estado).toBe('sem_loja');
  });

  /*
   * `null` é "nunca conectou"; `[]` é "conectou e a Shopify não informou os
   * escopos". Tratar os dois igual esconderia uma conexão de pé.
   */
  it('escopos nulos são desconexão; lista vazia não', () => {
    expect(situacaoDaShopify(dados({ escopos: null })).estado).toBe('desconectada');
    expect(situacaoDaShopify(dados({ escopos: [] })).estado).toBe('escopos_faltando');
  });

  it('aponta exatamente o que faltou liberar', () => {
    const situacao = situacaoDaShopify(dados({ escopos: ['read_products', 'read_orders'] }));

    expect(situacao.estado).toBe('escopos_faltando');
    expect(situacao.faltando).toEqual(['read_customers', 'read_fulfillments']);
  });

  it('não se importa com espaço no que a Shopify devolveu', () => {
    const situacao = situacaoDaShopify(dados({ escopos: PEDIDOS.split(',').map((e) => ` ${e} `) }));

    expect(situacao.estado).toBe('conectada');
    expect(situacao.concedidos).toContain('read_orders');
  });

  /*
   * Escopo A MAIS não é problema: o lojista pode ter aceitado um app mais
   * antigo, com uma lista maior. Reclamar disso mandaria ele reconectar sem
   * motivo.
   */
  it('escopo sobrando não vira aviso', () => {
    const situacao = situacaoDaShopify(
      dados({ escopos: [...PEDIDOS.split(','), 'write_products'] }),
    );

    expect(situacao.estado).toBe('conectada');
  });

  it('domínio ausente vira string vazia, e não "null" na tela', () => {
    expect(situacaoDaShopify(dados({ shopDomain: null })).dominio).toBe('');
  });
});

describe('avisoDaShopify', () => {
  it('traduz cada código que as rotas de OAuth sabem devolver', () => {
    // Estes são os códigos que `install/route.ts` e `callback/route.ts`
    // redirecionam. Um código sem mensagem é uma tela que não explica nada.
    for (const codigo of [
      'conectada',
      'parcial',
      'escopos',
      'sem_loja',
      'sem_permissao',
      'nao_configurado',
      'dominio_invalido',
      'retorno_invalido',
      'token',
      'erro',
    ]) {
      const aviso = avisoDaShopify(codigo);
      expect(aviso, codigo).not.toBeNull();
      expect(aviso?.texto.length, codigo).toBeGreaterThan(20);
    }
  });

  /*
   * O código vem da barra de endereço. Ecoar na tela o que veio de lá é como
   * um XSS começa, então o que não está no mapa simplesmente não vira aviso.
   */
  it('código inventado não vira mensagem', () => {
    expect(avisoDaShopify('<script>alert(1)</script>')).toBeNull();
    expect(avisoDaShopify('')).toBeNull();
    expect(avisoDaShopify(null)).toBeNull();
    expect(avisoDaShopify(undefined)).toBeNull();
  });

  it('nenhuma mensagem tem jargão técnico do erro', () => {
    for (const [codigo, aviso] of Object.entries(AVISOS_DA_SHOPIFY)) {
      expect(aviso.texto, codigo).not.toMatch(/hmac|oauth|token de acesso|api_secret|500|4\d\d/i);
    }
  });

  it('só o que deu certo tem tom de sucesso', () => {
    expect(avisoDaShopify('conectada')?.tom).toBe('sucesso');
    expect(avisoDaShopify('desconectada')?.tom).toBe('sucesso');
    expect(avisoDaShopify('parcial')?.tom).toBe('atencao');
    expect(avisoDaShopify('token')?.tom).toBe('erro');
  });
});

describe('conferirDominioDigitado', () => {
  it('aceita o que o lojista costuma digitar', () => {
    for (const digitado of [
      'minha-loja.myshopify.com',
      'MINHA-LOJA.myshopify.com',
      '  minha-loja.myshopify.com  ',
      'https://minha-loja.myshopify.com',
      'https://minha-loja.myshopify.com/admin',
      'minha-loja',
    ]) {
      const conferido = conferirDominioDigitado(digitado);
      expect(conferido.ok, digitado).toBe(true);
      if (conferido.ok) expect(conferido.shop).toBe('minha-loja.myshopify.com');
    }
  });

  it('recusa o que não é loja Shopify, com mensagem que ensina o formato', () => {
    for (const digitado of ['', '   ', 'evil.com', 'loja.myshopify.com.evil.com', 'https://']) {
      const conferido = conferirDominioDigitado(digitado);
      expect(conferido.ok, digitado).toBe(false);
      if (!conferido.ok) expect(conferido.erro.length).toBeGreaterThan(10);
    }
  });

  it('campo vazio tem mensagem própria, e não a de formato errado', () => {
    const vazio = conferirDominioDigitado('');
    const errado = conferirDominioDigitado('evil.com');

    expect(vazio.ok).toBe(false);
    expect(errado.ok).toBe(false);
    if (!vazio.ok && !errado.ok) expect(vazio.erro).not.toBe(errado.erro);
  });
});

describe('rotuloDoEscopo', () => {
  it('traduz os escopos que pedimos', () => {
    expect(rotuloDoEscopo('read_orders')).toBe('Ver pedidos');
    expect(rotuloDoEscopo('read_products')).toBe('Ver produtos');
  });

  /*
   * Escopo que a Shopify criar depois aparece cru, e não some da tela: uma
   * permissão concedida que o painel não lista é uma permissão que o lojista
   * não sabe que deu.
   */
  it('escopo desconhecido aparece como veio', () => {
    expect(rotuloDoEscopo('read_inventory')).toBe('read_inventory');
  });
});

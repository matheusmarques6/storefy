import { describe, expect, it } from 'vitest';
import {
  assinaturaSchema,
  avisoDaCobranca,
  cnpjValido,
  cpfValido,
  descreverDocumento,
  descreverLimite,
  diasEntre,
  finalDoDocumento,
  formatarDia,
  formatarPreco,
  interpretarAviso,
  lerPreco,
  planoSchema,
  primeiroVencimento,
  reaisParaAsaas,
  somarDias,
  situacaoDaFatura,
  tipoDoDocumento,
  type SituacaoDaCobranca,
} from './cobranca';

describe('dinheiro', () => {
  it('formata em reais', () => {
    expect(formatarPreco(9990).replace(/\s/g, ' ')).toBe('R$ 99,90');
    expect(formatarPreco(129990).replace(/\s/g, ' ')).toBe('R$ 1.299,90');
  });

  it('lê o preço do jeito que se digita no Brasil', () => {
    expect(lerPreco('99,90')).toBe(9990);
    expect(lerPreco('10,5')).toBe(1050);
    expect(lerPreco('1.299,90')).toBe(129990);
    expect(lerPreco('R$ 99')).toBe(9900);
    expect(lerPreco('99.90')).toBe(9990);
    expect(lerPreco('1.299')).toBe(129900);
  });

  it('e não inventa número do que não é preço', () => {
    for (const texto of ['', 'abc', '99,999', '1,2,3', '-10', '12.34.5']) {
      expect(lerPreco(texto), texto).toBeNull();
    }
  });

  it('manda para a Asaas em reais, sem erro de vírgula flutuante', () => {
    expect(reaisParaAsaas(9990)).toBe(99.9);
    expect(reaisParaAsaas(19900)).toBe(199);
  });
});

describe('CPF e CNPJ', () => {
  it('confere os dígitos do CPF', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('5299822472')).toBe(false);
  });

  it('confere os dígitos do CNPJ numérico', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11.222.333/0001-80')).toBe(false);
    expect(cnpjValido('00.000.000/0000-00')).toBe(false);
  });

  it('e do CNPJ alfanumérico (o exemplo da Receita)', () => {
    expect(cnpjValido('12.ABC.345/01DE-35')).toBe(true);
    expect(cnpjValido('12.abc.345/01de-35')).toBe(true);
    expect(cnpjValido('12.ABC.345/01DE-36')).toBe(false);
    // Os verificadores continuam números.
    expect(cnpjValido('12.ABC.345/01DE-3A')).toBe(false);
  });

  it('diz o tipo e guarda só o final', () => {
    expect(tipoDoDocumento('529.982.247-25')).toBe('cpf');
    expect(tipoDoDocumento('12.ABC.345/01DE-35')).toBe('cnpj');
    expect(tipoDoDocumento('123')).toBeNull();
    expect(finalDoDocumento('11.222.333/0001-81')).toBe('0181');
    expect(descreverDocumento('cnpj', '0181')).toBe('CNPJ final 0181');
  });
});

describe('formulários', () => {
  it('assinar pede plano, nome, documento válido e e-mail', () => {
    const erro = assinaturaSchema.safeParse({
      plano: 'x',
      nome: 'A',
      documento: '123',
      email: 'x',
    });
    expect(erro.success).toBe(false);
    const texto = JSON.stringify(erro.error?.issues);
    expect(texto).toContain('Escolha um plano.');
    expect(texto).toContain('CPF ou CNPJ inválido');
    expect(texto).toContain('E-mail inválido');

    const certo = assinaturaSchema.safeParse({
      plano: '0b9d7d1e-8f5a-4c3b-9a51-2f7e6c4d3b21',
      nome: ' Loja Aurora Ltda ',
      documento: '11.222.333/0001-81',
      email: ' Financeiro@Aurora.com.br ',
    });
    expect(certo.success && certo.data.email).toBe('financeiro@aurora.com.br');
    expect(certo.success && certo.data.nome).toBe('Loja Aurora Ltda');
  });

  it('o plano lê preço e limites; vazio é sem limite', () => {
    const certo = planoSchema.safeParse({
      nome: 'Essencial',
      descricao: '',
      preco: '99,90',
      limiteLojas: '2',
      limiteAparelhos: '',
      limiteCampanhas: '30',
      disponivel: true,
      valeNoTeste: false,
    });
    expect(certo.success).toBe(true);
    if (certo.success) {
      expect(certo.data.preco).toBe(9990);
      expect(certo.data.limiteLojas).toBe(2);
      expect(certo.data.limiteAparelhos).toBeNull();
      expect(certo.data.limiteCampanhas).toBe(30);
    }
  });

  it('e recusa com a explicação: preço abaixo do mínimo da Asaas, limite torto', () => {
    const erro = planoSchema.safeParse({
      nome: 'E',
      descricao: '',
      preco: '4,99',
      limiteLojas: '0',
      limiteAparelhos: 'muitos',
      limiteCampanhas: '',
      disponivel: true,
      valeNoTeste: false,
    });
    expect(erro.success).toBe(false);
    const texto = JSON.stringify(erro.error?.issues);
    expect(texto).toContain('pelo menos 2 letras');
    expect(texto).toContain('R$ 5,00');
    expect(texto).toContain('Lojas: de 1 a 1.000');
    expect(texto).toContain('Aparelhos ativos: use só números');
  });

  it('descreve o limite', () => {
    expect(descreverLimite(1, 'loja', 'lojas', 'Lojas sem limite')).toBe('Até 1 loja');
    expect(descreverLimite(1500, 'aparelho', 'aparelhos', '')).toBe('Até 1.500 aparelhos');
    expect(descreverLimite(null, 'loja', 'lojas', 'Lojas sem limite')).toBe('Lojas sem limite');
  });
});

describe('datas', () => {
  it('a primeira cobrança vence no fim do teste, ou hoje se ele já acabou', () => {
    expect(primeiroVencimento('2026-09-29', '2026-10-13')).toBe('2026-10-13');
    expect(primeiroVencimento('2026-10-20', '2026-10-13')).toBe('2026-10-20');
  });

  it('formata e conta dias sem passar por fuso', () => {
    expect(formatarDia('2026-10-13')).toBe('13/10/2026');
    expect(diasEntre('2026-09-29', '2026-10-13')).toBe(14);
    expect(diasEntre('2026-10-13', '2026-10-12')).toBe(-1);
    // Virada do horário de verão não entra: é conta de calendário.
    expect(diasEntre('2026-02-28', '2026-03-01')).toBe(1);
    expect(somarDias('2026-09-29', 90)).toBe('2026-12-28');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('avisos da Asaas', () => {
  const pagamento = {
    id: 'evt_abc',
    event: 'PAYMENT_RECEIVED',
    dateCreated: '2026-09-29 10:00:00',
    payment: {
      object: 'payment',
      id: 'pay_1',
      subscription: 'sub_1',
      value: 99.9,
      status: 'RECEIVED',
      dueDate: '2026-10-13',
      paymentDate: '2026-10-14',
      clientPaymentDate: '2026-10-13',
      invoiceUrl: 'https://www.asaas.com/i/pay_1',
    },
  };

  it('pagamento recebido vira fatura paga, na data em que o cliente pagou', () => {
    expect(interpretarAviso(pagamento)).toEqual({
      tipo: 'fatura',
      evento: 'evt_abc',
      nome: 'PAYMENT_RECEIVED',
      fatura: 'pay_1',
      assinatura: 'sub_1',
      valorCentavos: 9990,
      situacao: 'paid',
      vencimento: '2026-10-13',
      pagaEm: '2026-10-13',
      link: 'https://www.asaas.com/i/pay_1',
    });
  });

  it('cobrança removida é cancelada, qualquer que seja a situação que vier junto', () => {
    const aviso = interpretarAviso({
      ...pagamento,
      event: 'PAYMENT_DELETED',
      payment: { ...pagamento.payment, status: 'PENDING', deleted: true },
    });
    expect(aviso.tipo === 'fatura' && aviso.situacao).toBe('canceled');
    expect(aviso.tipo === 'fatura' && aviso.pagaEm).toBeNull();
  });

  it('assinatura removida na Asaas encerra a nossa', () => {
    expect(
      interpretarAviso({
        id: 'evt_2',
        event: 'SUBSCRIPTION_DELETED',
        subscription: { id: 'sub_1' },
      }),
    ).toEqual({
      tipo: 'assinatura_encerrada',
      evento: 'evt_2',
      nome: 'SUBSCRIPTION_DELETED',
      assinatura: 'sub_1',
    });
  });

  it('o que não é de assinatura, ou não se conhece, é ignorado com o motivo', () => {
    const semAssinatura = interpretarAviso({
      ...pagamento,
      payment: { ...pagamento.payment, subscription: null },
    });
    expect(semAssinatura).toEqual({
      tipo: 'ignorado',
      motivo: 'cobrança avulsa, fora de assinatura',
    });
    expect(interpretarAviso({ ...pagamento, event: 'TRANSFER_DONE' }).tipo).toBe('ignorado');
    expect(
      interpretarAviso({ ...pagamento, payment: { ...pagamento.payment, status: 'NOVIDADE' } }),
    ).toEqual({ tipo: 'ignorado', motivo: 'situação NOVIDADE' });
    expect(interpretarAviso('lixo').tipo).toBe('ignorado');
    expect(interpretarAviso({ id: '', event: 'PAYMENT_RECEIVED' }).tipo).toBe('ignorado');
  });

  it('link que não é da web não vira link', () => {
    const aviso = interpretarAviso({
      ...pagamento,
      payment: { ...pagamento.payment, invoiceUrl: 'javascript:alert(1)' },
    });
    expect(aviso.tipo === 'fatura' && aviso.link).toBeNull();
  });

  it('as situações da Asaas, uma a uma', () => {
    expect(situacaoDaFatura('PENDING')).toBe('pending');
    expect(situacaoDaFatura('CONFIRMED')).toBe('paid');
    expect(situacaoDaFatura('RECEIVED_IN_CASH')).toBe('paid');
    expect(situacaoDaFatura('OVERDUE')).toBe('overdue');
    expect(situacaoDaFatura('CHARGEBACK_REQUESTED')).toBe('refunded');
    expect(situacaoDaFatura('DELETED')).toBe('canceled');
    expect(situacaoDaFatura('')).toBeNull();
  });
});

describe('a faixa da cobrança', () => {
  const base: SituacaoDaCobranca = {
    emDia: true,
    liberadoAte: '2026-10-13',
    testeAte: '2026-10-13',
    assinatura: null,
    planoId: null,
    planoNome: null,
    valorCentavos: null,
    pagoAte: null,
    inadimplenteDesde: null,
    canceladaEm: null,
    limitesDoTeste: false,
    limiteLojas: null,
    limiteAparelhos: null,
    limiteCampanhasMes: null,
    hoje: '2026-09-29',
  };

  it('teste longe do fim: nada a dizer', () => {
    expect(avisoDaCobranca(base)).toBeNull();
  });

  it('teste acabando: lembra com a data, sem assustar', () => {
    expect(avisoDaCobranca({ ...base, hoje: '2026-10-08' })).toEqual({
      grave: false,
      texto: 'Seu teste grátis acaba em 5 dias (13/10/2026).',
      acao: 'Escolher um plano',
    });
    expect(avisoDaCobranca({ ...base, hoje: '2026-10-13' })?.texto).toBe(
      'Seu teste grátis acaba hoje.',
    );
  });

  it('travada: diz o motivo, o que parou e que o app continua', () => {
    const aviso = avisoDaCobranca({ ...base, emDia: false, hoje: '2026-10-20' });
    expect(aviso?.grave).toBe(true);
    expect(aviso?.texto).toContain('O período de teste acabou.');
    expect(aviso?.texto).toContain('O app continua funcionando');
    expect(avisoDaCobranca({ ...base, emDia: false, assinatura: 'canceled' })?.texto).toContain(
      'A assinatura foi cancelada.',
    );
  });

  it('fatura em atraso dentro da tolerância: diz até quando pagar', () => {
    expect(avisoDaCobranca({ ...base, assinatura: 'past_due', liberadoAte: '2026-10-20' })).toEqual(
      {
        grave: false,
        texto: 'Há uma fatura em atraso. Pague até 20/10/2026 para nada parar.',
        acao: 'Pagar a fatura',
      },
    );
  });

  it('assinou no teste e a primeira fatura ainda não venceu: nada a dizer', () => {
    expect(avisoDaCobranca({ ...base, assinatura: 'pending' })).toBeNull();
    expect(
      avisoDaCobranca({
        ...base,
        assinatura: 'pending',
        hoje: '2026-10-15',
        liberadoAte: '2026-10-20',
      })?.texto,
    ).toBe(
      'O teste acabou e a primeira fatura está em aberto. Pague até 20/10/2026 para nada parar.',
    );
  });
});

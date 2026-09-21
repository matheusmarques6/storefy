import { describe, expect, it } from 'vitest';
import { JANELA_MAXIMA, JANELA_PADRAO, janelaDaConsolidacao } from '@/lib/analytics';

describe('janelaDaConsolidacao', () => {
  it('sem parâmetro, recalcula a janela padrão', () => {
    expect(janelaDaConsolidacao(null)).toBe(JANELA_PADRAO);
    expect(janelaDaConsolidacao(undefined)).toBe(JANELA_PADRAO);
    expect(janelaDaConsolidacao('')).toBe(JANELA_PADRAO);
  });

  it('aceita um número de dias', () => {
    expect(janelaDaConsolidacao('7')).toBe(7);
    expect(janelaDaConsolidacao('  30  ')).toBe(30);
    expect(janelaDaConsolidacao('1')).toBe(1);
  });

  /*
   * `?dias=abc` virando `NaN` faria o banco recalcular a janela mínima em
   * silêncio — e os dias atrasados ficariam de fora para sempre.
   */
  it('o que não é inteiro positivo vira o padrão, e não NaN', () => {
    for (const bruto of ['abc', '-5', '3.5', '1e3', ' ', '0', 'null', '٣']) {
      expect(janelaDaConsolidacao(bruto), bruto).toBe(JANELA_PADRAO);
    }
  });

  it('e o teto é respeitado', () => {
    expect(janelaDaConsolidacao('9999')).toBe(JANELA_MAXIMA);
    expect(janelaDaConsolidacao('90')).toBe(JANELA_MAXIMA);
  });

  it('número grande demais para ser inteiro seguro não passa', () => {
    expect(janelaDaConsolidacao('99999999999999999999')).toBe(JANELA_PADRAO);
  });
});

import {
  PERIODOS,
  PERIODO_PADRAO,
  comoNumero,
  comoPorcentagem,
  comoReais,
  diaCurto,
  diasEntre,
  fatiaDoApp,
  lerPeriodo,
  diaNaTimezone,
  janelaDoPeriodo,
  serieCompleta,
  somarPeriodo,
  temMovimento,
  type DiaDeNumeros,
} from '@/lib/analytics';

function dia(day: string, extra: Partial<DiaDeNumeros> = {}): DiaDeNumeros {
  return {
    day,
    installs: 0,
    active_users: 0,
    sessions: 0,
    push_sent: 0,
    push_opened: 0,
    orders_app: 0,
    revenue_app_cents: 0,
    orders_site: 0,
    revenue_site_cents: 0,
    ...extra,
  };
}

describe('lerPeriodo', () => {
  it('aceita só os períodos oferecidos', () => {
    for (const periodo of PERIODOS) {
      expect(lerPeriodo(String(periodo.dias))).toBe(periodo.dias);
    }
  });

  /*
   * O período vem da barra de endereço e vira janela de consulta. Um valor
   * inventado não pode virar uma varredura de mil dias.
   */
  it('qualquer outra coisa cai no padrão', () => {
    for (const bruto of ['1000', '0', '-7', 'abc', '', null, undefined, '30.0000001']) {
      expect(lerPeriodo(bruto), String(bruto)).toBe(PERIODO_PADRAO);
    }
  });
});

describe('somarPeriodo', () => {
  it('soma o que é somável', () => {
    const totais = somarPeriodo([
      dia('2026-09-01', { installs: 3, sessions: 10, orders_app: 2, revenue_app_cents: 15000 }),
      dia('2026-09-02', { installs: 1, sessions: 4, orders_site: 1, revenue_site_cents: 5000 }),
    ]);

    expect(totais.installs).toBe(4);
    expect(totais.sessions).toBe(14);
    expect(totais.ordersApp).toBe(2);
    expect(totais.revenueAppCents).toBe(15000);
    expect(totais.ordersSite).toBe(1);
    expect(totais.revenueSiteCents).toBe(5000);
  });

  /*
   * Ativos NÃO se somam: quem abriu o app nos dois dias contaria duas vezes.
   * O que a tela mostra é média e pico — e o total do período vem de
   * `ativos_no_periodo`, que conta aparelho distinto no banco.
   */
  it('ativos viram média e pico, nunca soma', () => {
    const totais = somarPeriodo([
      dia('2026-09-01', { active_users: 10 }),
      dia('2026-09-02', { active_users: 20 }),
      dia('2026-09-03', { active_users: 30 }),
    ]);

    expect(totais.mediaDeAtivos).toBe(20);
    expect(totais.picoDeAtivos).toBe(30);
    expect(totais).not.toHaveProperty('activeUsers');
  });

  it('período vazio não divide por zero', () => {
    const totais = somarPeriodo([]);

    expect(totais.mediaDeAtivos).toBe(0);
    expect(Number.isNaN(totais.mediaDeAtivos)).toBe(false);
    expect(totais.diasComDados).toBe(0);
  });
});

describe('fatiaDoApp', () => {
  it('diz quanto da receita veio do app', () => {
    const totais = somarPeriodo([
      dia('2026-09-01', { revenue_app_cents: 7500, revenue_site_cents: 2500 }),
    ]);

    expect(fatiaDoApp(totais)).toBeCloseTo(0.75);
  });

  /*
   * Loja parada devolve `null`, e não 0%. Mostrar zero diria ao lojista que o
   * app está falhando quando ninguém comprou em lugar nenhum.
   */
  it('sem venda nenhuma é null, e não zero por cento', () => {
    expect(fatiaDoApp(somarPeriodo([dia('2026-09-01', { sessions: 40 })]))).toBeNull();
  });

  it('mas app sem venda com site vendendo é zero de verdade', () => {
    const totais = somarPeriodo([dia('2026-09-01', { revenue_site_cents: 9900 })]);

    expect(fatiaDoApp(totais)).toBe(0);
  });
});

describe('temMovimento', () => {
  it('é falso quando nada aconteceu', () => {
    expect(temMovimento(somarPeriodo([]))).toBe(false);
    expect(temMovimento(somarPeriodo([dia('2026-09-01')]))).toBe(false);
  });

  it('e verdadeiro com qualquer sinal de vida', () => {
    for (const extra of [
      { installs: 1 },
      { sessions: 1 },
      { push_sent: 1 },
      { orders_app: 1 },
      { orders_site: 1 },
      { active_users: 1 },
    ]) {
      expect(temMovimento(somarPeriodo([dia('2026-09-01', extra)])), JSON.stringify(extra)).toBe(
        true,
      );
    }
  });
});

describe('formatação', () => {
  it('centavos viram reais', () => {
    expect(comoReais(14990)).toContain('149,90');
    expect(comoReais(0)).toContain('0,00');
    expect(comoReais(100000000)).toContain('1.000.000,00');
  });

  /* A conta fica em centavos até o fim: somar 149.90 em float erra na terceira casa. */
  it('e a soma de centavos não perde centavo', () => {
    const totais = somarPeriodo(
      Array.from({ length: 30 }, (_, i) =>
        dia(`2026-09-${String(i + 1)}`, { revenue_app_cents: 14990 }),
      ),
    );

    expect(totais.revenueAppCents).toBe(449700);
    expect(comoReais(totais.revenueAppCents)).toContain('4.497,00');
  });

  it('porcentagem inteira, e traço quando não há', () => {
    expect(comoPorcentagem(0.756)).toBe('76%');
    expect(comoPorcentagem(0)).toBe('0%');
    expect(comoPorcentagem(null)).toBe('—');
  });

  it('número com separador de milhar', () => {
    expect(comoNumero(1234)).toBe('1.234');
  });

  it('o rótulo do eixo é dia/mês', () => {
    expect(diaCurto('2026-09-21')).toBe('21/09');
    // Entrada estranha não vira "undefined/undefined" na tela.
    expect(diaCurto('nada')).toBe('nada');
  });
});

describe('serieCompleta', () => {
  /*
   * O banco não guarda dia vazio, e está certo. No gráfico o buraco mente de
   * outro jeito: uma linha que pula de segunda para quinta parece contínua e
   * esconde os dias parados.
   */
  it('preenche os dias sem linha com zeros', () => {
    const serie = serieCompleta([dia('2026-09-03', { sessions: 5 })], '2026-09-01', '2026-09-04');

    expect(serie.map((d) => d.day)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
    ]);
    expect(serie.map((d) => d.sessions)).toEqual([0, 0, 5, 0]);
  });

  it('mantém o que veio do banco intacto', () => {
    const original = dia('2026-09-02', { revenue_app_cents: 12345 });
    const serie = serieCompleta([original], '2026-09-01', '2026-09-02');

    expect(serie[1]).toBe(original);
  });

  it('intervalo invertido não vira série infinita', () => {
    expect(diasEntre('2026-09-10', '2026-09-01')).toEqual([]);
    expect(serieCompleta([], '2026-09-10', '2026-09-01')).toEqual([]);
  });

  it('data inválida não vira NaN na tela', () => {
    expect(diasEntre('nada', '2026-09-01')).toEqual([]);
  });

  /* Teto de segurança: uma janela absurda travaria o navegador. */
  it('a série tem teto', () => {
    expect(diasEntre('2020-01-01', '2026-01-01').length).toBeLessThanOrEqual(401);
  });

  /* Atravessa a virada do mês sem pular nem repetir dia. */
  it('atravessa a virada do mês', () => {
    expect(diasEntre('2026-01-30', '2026-02-02')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
  });
});

describe('diaNaTimezone', () => {
  /*
   * 02h30 em UTC ainda é o dia anterior em São Paulo. É exatamente aqui que o
   * gráfico começaria um dia adiantado e o lojista veria a venda de ontem
   * aparecer como de hoje.
   */
  it('devolve o dia NO FUSO da loja', () => {
    const momento = new Date('2026-03-10T02:30:00Z');

    expect(diaNaTimezone(momento, 'America/Sao_Paulo')).toBe('2026-03-09');
    expect(diaNaTimezone(momento, 'UTC')).toBe('2026-03-10');
    // Tóquio já virou duas datas à frente de São Paulo nesse instante.
    expect(diaNaTimezone(momento, 'Asia/Tokyo')).toBe('2026-03-10');
  });

  /* Fuso mal digitado no cadastro não pode derrubar a tela inteira. */
  it('fuso inválido cai no UTC em vez de lançar', () => {
    expect(diaNaTimezone(new Date('2026-03-10T02:30:00Z'), 'Marte/Olympus')).toBe('2026-03-10');
  });

  it('o formato é o mesmo que o Postgres devolve', () => {
    expect(diaNaTimezone(new Date('2026-01-05T12:00:00Z'), 'UTC')).toBe('2026-01-05');
  });
});

describe('janelaDoPeriodo', () => {
  it('o período termina hoje e inclui hoje', () => {
    expect(janelaDoPeriodo('2026-09-21', 7)).toEqual({ de: '2026-09-15', ate: '2026-09-21' });
    expect(diasEntre('2026-09-15', '2026-09-21')).toHaveLength(7);
  });

  it('um dia é só hoje', () => {
    expect(janelaDoPeriodo('2026-09-21', 1)).toEqual({ de: '2026-09-21', ate: '2026-09-21' });
  });

  it('atravessa a virada do ano', () => {
    expect(janelaDoPeriodo('2026-01-02', 7).de).toBe('2025-12-27');
  });

  it('data estranha não vira NaN na consulta', () => {
    expect(janelaDoPeriodo('nada', 7)).toEqual({ de: 'nada', ate: 'nada' });
  });
});

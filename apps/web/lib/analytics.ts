/**
 * As decisões dos números diários (seção 9 do plano).
 *
 * Puro e testável, separado do IO como o resto: o que decide quanto tempo
 * recalcular não pode depender de ter um banco na frente.
 */

/** Quantos dias o job recalcula quando ninguém pede outra coisa. */
export const JANELA_PADRAO = 3;

/**
 * O teto existe do lado do banco também, e de propósito.
 *
 * `consolidar_analytics` limita a 90 dias porque ela é chamável por outros
 * caminhos um dia; aqui o limite volta a aparecer para a rota não mandar um
 * número absurdo e receber um resultado diferente do que pediu, sem aviso.
 */
export const JANELA_MAXIMA = 90;

/**
 * Quantos dias recalcular, a partir do `?dias=` da chamada.
 *
 * Três por padrão: o dia de ontem ainda não acabou em todo fuso quando acaba
 * aqui, a Shopify reentrega webhook por horas e o aparelho sem rede reporta
 * depois. Um dia só deixaria esses atrasados de fora para sempre.
 *
 * Qualquer coisa que não seja um inteiro vira o padrão. Um `?dias=abc` que
 * virasse `NaN` faria o banco recalcular a janela mínima em silêncio.
 */
export function janelaDaConsolidacao(bruto: string | null | undefined): number {
  if (bruto == null || !/^\d+$/.test(bruto.trim())) return JANELA_PADRAO;

  const numero = Number(bruto.trim());
  if (!Number.isSafeInteger(numero) || numero < 1) return JANELA_PADRAO;

  return Math.min(numero, JANELA_MAXIMA);
}

/* ------------------------------------------------------------ a tela C11 */

/** Um dia de `analytics_daily`, como o painel o lê. */
export interface DiaDeNumeros {
  day: string;
  installs: number;
  active_users: number;
  sessions: number;
  push_sent: number;
  push_opened: number;
  orders_app: number;
  revenue_app_cents: number;
  orders_site: number;
  revenue_site_cents: number;
}

export interface Periodo {
  /** Vai na URL: `?periodo=30`. */
  dias: number;
  rotulo: string;
}

/**
 * Os períodos que a tela oferece.
 *
 * Sete, trinta e noventa. Não há "desde sempre": o lojista compara semana com
 * semana e mês com mês, e um total desde a instalação cresce sozinho — parece
 * resultado sem ser.
 */
export const PERIODOS: readonly Periodo[] = [
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 90, rotulo: '90 dias' },
];

export const PERIODO_PADRAO = 30;

export function lerPeriodo(bruto: string | null | undefined): number {
  const escolhido = PERIODOS.find((periodo) => periodo.dias === Number(bruto));
  return escolhido?.dias ?? PERIODO_PADRAO;
}

export interface TotaisDoPeriodo {
  installs: number;
  sessions: number;
  pushSent: number;
  pushOpened: number;
  ordersApp: number;
  revenueAppCents: number;
  ordersSite: number;
  revenueSiteCents: number;
  /** Média de aparelhos ativos por dia COM movimento, arredondada. */
  mediaDeAtivos: number;
  /** O maior número de ativos num único dia do período. */
  picoDeAtivos: number;
  /** Quantos dias do período têm alguma linha. */
  diasComDados: number;
}

export function somarPeriodo(dias: readonly DiaDeNumeros[]): TotaisDoPeriodo {
  const totais: TotaisDoPeriodo = {
    installs: 0,
    sessions: 0,
    pushSent: 0,
    pushOpened: 0,
    ordersApp: 0,
    revenueAppCents: 0,
    ordersSite: 0,
    revenueSiteCents: 0,
    mediaDeAtivos: 0,
    picoDeAtivos: 0,
    diasComDados: dias.length,
  };

  let somaDeAtivos = 0;
  for (const dia of dias) {
    totais.installs += dia.installs;
    totais.sessions += dia.sessions;
    totais.pushSent += dia.push_sent;
    totais.pushOpened += dia.push_opened;
    totais.ordersApp += dia.orders_app;
    totais.revenueAppCents += dia.revenue_app_cents;
    totais.ordersSite += dia.orders_site;
    totais.revenueSiteCents += dia.revenue_site_cents;

    somaDeAtivos += dia.active_users;
    if (dia.active_users > totais.picoDeAtivos) totais.picoDeAtivos = dia.active_users;
  }

  /*
   * A média divide pelos dias COM LINHA, e não pelos dias do período. Um app
   * publicado há três dias teria a média dividida por trinta, e o número
   * apareceria baixo por um motivo que não tem nada a ver com o app.
   */
  totais.mediaDeAtivos = dias.length === 0 ? 0 : Math.round(somaDeAtivos / dias.length);

  return totais;
}

/**
 * Quanto da receita veio do app, de 0 a 1. `null` quando não houve venda.
 *
 * `null` e não zero: "o app não vendeu nada" e "ninguém comprou em lugar
 * nenhum" são coisas diferentes, e mostrar 0% no segundo caso diria ao lojista
 * que o app está falhando quando a loja inteira está parada.
 */
export function fatiaDoApp(totais: TotaisDoPeriodo): number | null {
  const total = totais.revenueAppCents + totais.revenueSiteCents;
  return total === 0 ? null : totais.revenueAppCents / total;
}

/** O período tem algum número? Decide entre o gráfico e o estado vazio. */
export function temMovimento(totais: TotaisDoPeriodo): boolean {
  return (
    totais.installs > 0 ||
    totais.sessions > 0 ||
    totais.pushSent > 0 ||
    totais.ordersApp > 0 ||
    totais.ordersSite > 0 ||
    totais.picoDeAtivos > 0
  );
}

/**
 * Centavos viram reais, como o lojista lê.
 *
 * A conta é feita em centavos até aqui de propósito: somar `149.90` trinta
 * vezes em ponto flutuante erra na terceira casa, e o total do mês sai com
 * centavo a mais ou a menos do que a soma dos dias.
 */
export function comoReais(centavos: number, moeda = 'BRL'): string {
  return (centavos / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: moeda,
    minimumFractionDigits: 2,
  });
}

/** Fração vira porcentagem inteira. `null` vira traço. */
export function comoPorcentagem(fracao: number | null): string {
  if (fracao === null) return '—';
  return `${Math.round(fracao * 100).toLocaleString('pt-BR')}%`;
}

export function comoNumero(valor: number): string {
  return valor.toLocaleString('pt-BR');
}

/** `2026-09-21` vira `21/09`, que é o rótulo do eixo do gráfico. */
export function diaCurto(dia: string): string {
  const [, mes, numero] = dia.split('-');
  return mes == null || numero == null ? dia : `${numero}/${mes}`;
}

/**
 * Preenche os dias sem linha com zeros, para o gráfico.
 *
 * O BANCO NÃO GUARDA DIA VAZIO — é a regra 1 do CLAUDE.md, e ela está certa:
 * linha de zeros no banco é dado inventado. No GRÁFICO, porém, o buraco mente
 * de outro jeito: uma linha que pula de segunda para quinta parece contínua e
 * esconde os dois dias parados. Zero aqui é a verdade desenhada, e a série
 * nunca é gravada de volta.
 */
export function serieCompleta(
  dias: readonly DiaDeNumeros[],
  de: string,
  ate: string,
): DiaDeNumeros[] {
  const porDia = new Map(dias.map((dia) => [dia.day, dia]));
  const serie: DiaDeNumeros[] = [];

  for (const dia of diasEntre(de, ate)) {
    serie.push(porDia.get(dia) ?? diaVazio(dia));
  }
  return serie;
}

/** As datas de `de` a `ate`, inclusive, em `YYYY-MM-DD`. */
export function diasEntre(de: string, ate: string): string[] {
  const inicio = Date.parse(`${de}T00:00:00Z`);
  const fim = Date.parse(`${ate}T00:00:00Z`);
  if (Number.isNaN(inicio) || Number.isNaN(fim) || fim < inicio) return [];

  const dias: string[] = [];
  const UM_DIA = 24 * 60 * 60 * 1000;
  // Teto de segurança: `serieCompleta` desenha, e uma janela absurda travaria
  // o navegador em vez de mostrar um gráfico.
  for (let t = inicio; t <= fim && dias.length <= 400; t += UM_DIA) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias;
}

function diaVazio(day: string): DiaDeNumeros {
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
  };
}

/**
 * A data de um instante no fuso de uma loja, em `YYYY-MM-DD`.
 *
 * `en-CA` porque é o locale que formata data como `2026-09-21` — o mesmo
 * formato que o Postgres devolve para `date`, e é isso que deixa comparar as
 * duas pontas sem conversão no meio.
 *
 * Fuso inválido não derruba a tela: o `Intl` lança, e aí vale o UTC. Um painel
 * fora do ar por causa de um campo de fuso mal digitado seria bem pior do que
 * um gráfico algumas horas deslocado.
 */
export function diaNaTimezone(momento: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(momento);
  } catch {
    return momento.toISOString().slice(0, 10);
  }
}

/** O primeiro e o último dia de um período que termina hoje, inclusive. */
export function janelaDoPeriodo(hoje: string, dias: number): { de: string; ate: string } {
  const fim = Date.parse(`${hoje}T00:00:00Z`);
  if (Number.isNaN(fim)) return { de: hoje, ate: hoje };

  const inicio = new Date(fim - (Math.max(dias, 1) - 1) * 24 * 60 * 60 * 1000);
  return { de: inicio.toISOString().slice(0, 10), ate: hoje };
}

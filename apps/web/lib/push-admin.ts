/**
 * As decisões da A08 — o push de todas as lojas.
 *
 * A TELA RESPONDE DUAS PERGUNTAS QUE NÃO SÃO A MESMA, e misturá-las é o jeito
 * mais fácil de não responder nenhuma:
 *
 *   QUANTO VAI CUSTAR. A OneSignal cobra por aparelho ativo no mês. O app com
 *   mais ativos é o que mais pesa na fatura, mesmo que nunca mande um push.
 *
 *   O QUE ESTÁ QUEBRADO. Um app que manda muito e entrega pouco está com
 *   credencial ou configuração ruim. O número absoluto de falhas não diz isso:
 *   10 falhas em 10 envios é um app morto, 10 em 10.000 é ruído.
 *
 * Por isso a saúde é uma RAZÃO e não uma contagem, e por isso ela tem um piso
 * de volume: declarar "100% de falha" em cima de um único envio faria a tela
 * gritar por causa de um teste que o lojista fez e abandonou.
 */

/** Uma linha do `push_do_admin`, com os nulos que o tipo gerado permite. */
export interface LinhaDePushBruta {
  app_id: string | null;
  loja: string | null;
  organizacao: string | null;
  campanhas_enviadas: number | null;
  campanhas_falhas: number | null;
  entregues: number | null;
  abertos: number | null;
  automacoes_enviadas: number | null;
  automacoes_falhas: number | null;
  aparelhos: number | null;
  ativos: number | null;
}

export interface LinhaDePush {
  appId: string;
  loja: string;
  organizacao: string;
  enviados: number;
  falhas: number;
  entregues: number;
  abertos: number;
  aparelhos: number;
  ativos: number;
  /** Falhas sobre tentativas, de 0 a 1. `null` quando não houve tentativa. */
  taxaDeFalha: number | null;
  /** Aberturas sobre entregues. `null` quando não há entregue. */
  taxaDeAbertura: number | null;
  /** Merece atenção: falha demais, com volume que justifique olhar. */
  preocupante: boolean;
}

function numero(valor: number | null | undefined): number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 ? Math.trunc(valor) : 0;
}

/**
 * A partir de quantas tentativas uma taxa de falha significa alguma coisa.
 *
 * Abaixo disso a razão é barulho estatístico: um envio que falhou vira "100%",
 * e uma tela que grita por causa de um teste abandonado deixa de ser lida.
 */
export const MINIMO_PARA_JULGAR = 20;

/**
 * Acima de quanto a falha deixa de ser normal.
 *
 * Push falha um pouco sempre — aparelho desinstalado, token velho, usuário que
 * desligou a notificação. Um décimo é folgado o bastante para não acusar quem
 * está funcionando.
 */
export const FALHA_PREOCUPANTE = 0.1;

export function lerLinha(bruta: LinhaDePushBruta): LinhaDePush {
  const enviados = numero(bruta.campanhas_enviadas) + numero(bruta.automacoes_enviadas);
  const falhas = numero(bruta.campanhas_falhas) + numero(bruta.automacoes_falhas);
  const entregues = numero(bruta.entregues);
  const abertos = numero(bruta.abertos);

  // Tentativas é envio + falha: quem falhou também tentou, e dividir só pelos
  // que deram certo daria taxas acima de 100%.
  const tentativas = enviados + falhas;
  const taxaDeFalha = tentativas > 0 ? falhas / tentativas : null;

  return {
    appId: bruta.app_id ?? '',
    loja: bruta.loja ?? 'Loja removida',
    organizacao: bruta.organizacao ?? '—',
    enviados,
    falhas,
    entregues,
    abertos,
    aparelhos: numero(bruta.aparelhos),
    ativos: numero(bruta.ativos),
    taxaDeFalha,
    taxaDeAbertura: entregues > 0 ? abertos / entregues : null,
    preocupante:
      tentativas >= MINIMO_PARA_JULGAR && taxaDeFalha !== null && taxaDeFalha > FALHA_PREOCUPANTE,
  };
}

export interface TotaisDePush {
  apps: number;
  enviados: number;
  falhas: number;
  ativos: number;
  /** Quantos apps merecem atenção agora. */
  preocupantes: number;
}

/**
 * Os totais da plataforma.
 *
 * `ativos` SOMA os apps, e isso é correto aqui mesmo sendo errado dentro de um
 * app: um aparelho pertence a um app só, então não há como contá-lo duas
 * vezes. É a mesma pessoa com dois apps instalados? São dois aparelhos ativos
 * para a OneSignal, e são dois na fatura.
 */
export function totais(linhas: LinhaDePush[]): TotaisDePush {
  return {
    apps: linhas.length,
    enviados: linhas.reduce((soma, l) => soma + l.enviados, 0),
    falhas: linhas.reduce((soma, l) => soma + l.falhas, 0),
    ativos: linhas.reduce((soma, l) => soma + l.ativos, 0),
    preocupantes: linhas.filter((l) => l.preocupante).length,
  };
}

/** Os períodos que a tela oferece, em dias. */
export const PERIODOS = [7, 30, 90] as const;
export type Periodo = (typeof PERIODOS)[number];

/** O período pedido na URL. 30 dias é o padrão: é o ciclo da fatura. */
export function lerPeriodo(bruto: string | undefined): Periodo {
  const numero = Number(bruto);
  return PERIODOS.includes(numero as Periodo) ? (numero as Periodo) : 30;
}

/**
 * Fase 7 — a cobrança, na parte que não fala com ninguém: dinheiro, documento,
 * os formulários da C15 e da A09 e a leitura dos avisos da Asaas.
 *
 * O que libera ou trava a empresa NÃO mora aqui: é `cobranca_da_org`, no
 * banco, e as telas só leem o que ele responde. Duas contas da mesma regra
 * acabariam discordando.
 */
import { z } from 'zod';
import type { InvoiceStatus, SubscriptionStatus } from '@storefy/db';

// ------------------------------------------------------------------ dinheiro

const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$ 99,90". */
export function formatarPreco(centavos: number): string {
  return REAIS.format(centavos / 100);
}

/** O valor que a Asaas espera: reais, com duas casas. */
export function reaisParaAsaas(centavos: number): number {
  return Math.round(centavos) / 100;
}

/** O valor que a Asaas manda (reais, número) em centavos, sem erro de ponto flutuante. */
export function centavosDaAsaas(valor: number): number {
  return Math.round(valor * 100);
}

/**
 * O preço digitado na A09, em centavos, ou `null` quando não é um preço.
 *
 * Aceita o jeito brasileiro ("99,90", "1.299,90", "R$ 99") e, sem vírgula, o
 * ponto como decimal só quando ele separa exatamente dois dígitos ("99.90").
 * "1.299" é mil duzentos e noventa e nove.
 */
export function lerPreco(texto: string): number | null {
  const limpo = texto.replace(/R\$/gi, '').replace(/\s/g, '');
  if (limpo === '') return null;

  let normalizado: string;
  if (limpo.includes(',')) {
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(limpo)) return null;
    normalizado = limpo.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+\.\d{2}$/.test(limpo)) {
    normalizado = limpo;
  } else if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(limpo)) {
    normalizado = limpo.replace(/\./g, '');
  } else {
    return null;
  }

  const valor = Number(normalizado);
  return Number.isFinite(valor) ? Math.round(valor * 100) : null;
}

// ----------------------------------------------------------- CPF e CNPJ

/**
 * O documento como vai para a Asaas: só letras e números, em maiúsculas.
 *
 * Letras porque, desde julho de 2026, a Receita emite CNPJ alfanumérico: as
 * doze primeiras posições podem ter letras; os dois dígitos verificadores
 * continuam números.
 */
export function normalizarDocumento(texto: string): string {
  return texto.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/**
 * O valor de cada posição: o código ASCII menos 48. Para número, é ele mesmo;
 * no CNPJ alfanumérico, "A" vale 17 — é a regra da Receita. O documento já
 * passou pela expressão regular, então só tem ASCII.
 */
function valoresDoDocumento(doc: string): number[] {
  return Array.from({ length: doc.length }, (_, i) => doc.charCodeAt(i) - 48);
}

function digitoDoCpf(numeros: number[], pesoInicial: number): number {
  const soma = numeros.reduce((total, n, i) => total + n * (pesoInicial - i), 0);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

export function cpfValido(texto: string): boolean {
  const doc = normalizarDocumento(texto);
  if (!/^\d{11}$/.test(doc) || /^(\d)\1{10}$/.test(doc)) return false;
  const n = valoresDoDocumento(doc);
  return digitoDoCpf(n.slice(0, 9), 10) === n[9] && digitoDoCpf(n.slice(0, 10), 11) === n[10];
}

function digitoDoCnpj(valores: number[]): number {
  const pesos =
    valores.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = valores.reduce((total, v, i) => total + v * (pesos[i] ?? 0), 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cnpjValido(texto: string): boolean {
  const doc = normalizarDocumento(texto);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(doc) || /^(\d)\1{13}$/.test(doc)) return false;
  const valores = valoresDoDocumento(doc);
  const primeiro = digitoDoCnpj(valores.slice(0, 12));
  const segundo = digitoDoCnpj([...valores.slice(0, 12), primeiro]);
  return primeiro === valores[12] && segundo === valores[13];
}

export type TipoDeDocumento = 'cpf' | 'cnpj';

export function tipoDoDocumento(texto: string): TipoDeDocumento | null {
  if (cpfValido(texto)) return 'cpf';
  if (cnpjValido(texto)) return 'cnpj';
  return null;
}

/** Os quatro últimos caracteres: é o que fica guardado, e o que a tela mostra. */
export function finalDoDocumento(texto: string): string {
  return normalizarDocumento(texto).slice(-4);
}

export function descreverDocumento(tipo: string, final: string): string {
  return `${tipo === 'cnpj' ? 'CNPJ' : 'CPF'} final ${final}`;
}

// -------------------------------------------------------- os formulários

/** Assinar (C15): o plano e quem paga. */
export const assinaturaSchema = z.object({
  plano: z.string({ error: 'Escolha um plano.' }).pipe(z.uuid('Escolha um plano.')),
  nome: z
    .string({ error: 'Digite o nome ou a razão social.' })
    .trim()
    .min(2, 'Digite o nome ou a razão social, com pelo menos 2 letras.')
    .max(120, 'O nome passa de 120 caracteres.'),
  documento: z
    .string({ error: 'Digite o CPF ou o CNPJ.' })
    .trim()
    .refine(
      (valor) => tipoDoDocumento(valor) !== null,
      'CPF ou CNPJ inválido. Confira os números.',
    ),
  email: z
    .string({ error: 'Digite o e-mail que recebe as faturas.' })
    .trim()
    .toLowerCase()
    .min(1, 'Digite o e-mail que recebe as faturas.')
    .max(200, 'O e-mail é longo demais.')
    .pipe(z.email('E-mail inválido. Confira se digitou corretamente.')),
});

/** Trocar os dados de quem paga: igual, sem o plano. */
export const quemPagaSchema = assinaturaSchema.omit({ plano: true });

function limite(rotulo: string, maximo: number) {
  return z
    .string()
    .trim()
    .transform((valor, contexto) => {
      if (valor === '') return null;
      if (!/^\d+$/.test(valor)) {
        contexto.addIssue({
          code: 'custom',
          message: `${rotulo}: use só números, ou deixe vazio para não ter limite.`,
        });
        return z.NEVER;
      }
      const numero = Number(valor);
      if (numero < 1 || numero > maximo) {
        contexto.addIssue({
          code: 'custom',
          message: `${rotulo}: de 1 a ${maximo.toLocaleString('pt-BR')}, ou vazio para não ter limite.`,
        });
        return z.NEVER;
      }
      return numero;
    });
}

/** A09: um plano. Os limites vazios são "sem limite". */
export const planoSchema = z.object({
  nome: z
    .string({ error: 'Dê um nome ao plano.' })
    .trim()
    .min(2, 'Dê um nome ao plano, com pelo menos 2 letras.')
    .max(40, 'O nome passa de 40 caracteres.'),
  descricao: z.string().trim().max(200, 'A descrição passa de 200 caracteres.').default(''),
  preco: z
    .string({ error: 'Digite o preço mensal.' })
    .trim()
    .transform((valor, contexto) => {
      const centavos = lerPreco(valor);
      if (centavos === null) {
        contexto.addIssue({ code: 'custom', message: 'Digite o preço mensal, como 99,90.' });
        return z.NEVER;
      }
      if (centavos < 500 || centavos > 10_000_000) {
        contexto.addIssue({
          code: 'custom',
          message: 'O preço vai de R$ 5,00 (o mínimo que a Asaas cobra) a R$ 100.000,00.',
        });
        return z.NEVER;
      }
      return centavos;
    }),
  limiteLojas: limite('Lojas', 1000),
  limiteAparelhos: limite('Aparelhos ativos', 100_000_000),
  limiteCampanhas: limite('Campanhas por mês', 100_000),
  disponivel: z.boolean(),
  valeNoTeste: z.boolean(),
});

/** "Até 3 lojas", "Lojas sem limite". */
export function descreverLimite(
  valor: number | null,
  singular: string,
  plural: string,
  semLimite: string,
): string {
  if (valor === null) return semLimite;
  return `Até ${valor.toLocaleString('pt-BR')} ${valor === 1 ? singular : plural}`;
}

// ------------------------------------------------------ datas da cobrança

/**
 * O primeiro vencimento de uma assinatura nova: no fim do teste, se ele ainda
 * não acabou — quem assina no terceiro dia não perde os outros onze —; senão,
 * hoje. Datas "AAAA-MM-DD", no horário de Brasília.
 */
export function primeiroVencimento(hoje: string, testeAte: string): string {
  return testeAte > hoje ? testeAte : hoje;
}

/** "13/10/2026", de uma data "AAAA-MM-DD", sem passar por fuso nenhum. */
export function formatarDia(data: string): string {
  const [ano, mes, dia] = data.split('-');
  return `${dia ?? ''}/${mes ?? ''}/${ano ?? ''}`;
}

/** Uma data "AAAA-MM-DD" mais (ou menos) alguns dias, sem passar por fuso. */
export function somarDias(data: string, dias: number): string {
  const instante = Date.UTC(
    Number(data.slice(0, 4)),
    Number(data.slice(5, 7)) - 1,
    Number(data.slice(8, 10)) + dias,
  );
  return new Date(instante).toISOString().slice(0, 10);
}

/** Dias de uma data "AAAA-MM-DD" até outra (negativo quando já passou). */
export function diasEntre(de: string, ate: string): number {
  const um = Date.UTC(Number(de.slice(0, 4)), Number(de.slice(5, 7)) - 1, Number(de.slice(8, 10)));
  const outro = Date.UTC(
    Number(ate.slice(0, 4)),
    Number(ate.slice(5, 7)) - 1,
    Number(ate.slice(8, 10)),
  );
  return Math.round((outro - um) / 86_400_000);
}

// ---------------------------------------------------- avisos da Asaas

/**
 * A situação de uma cobrança da Asaas, na nossa língua. `null` é uma
 * situação que não conhecemos — o aviso é anotado como ignorado, e não vira
 * um palpite.
 */
export function situacaoDaFatura(status: string): InvoiceStatus | null {
  switch (status) {
    case 'PENDING':
    case 'AWAITING_RISK_ANALYSIS':
      return 'pending';
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH':
    case 'DUNNING_RECEIVED':
      return 'paid';
    case 'OVERDUE':
    case 'DUNNING_REQUESTED':
      return 'overdue';
    // Estorno pedido, em andamento ou disputa de cartão: o dinheiro não está
    // garantido, e a fatura não conta como paga.
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return 'refunded';
    case 'DELETED':
      return 'canceled';
    default:
      return null;
  }
}

const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish();

const avisoSchema = z.looseObject({
  id: z.string().min(1).max(100),
  event: z.string().min(1).max(80),
  payment: z
    .looseObject({
      id: z.string().min(1).max(100),
      subscription: z.string().max(100).nullish(),
      value: z.number().nullish(),
      status: z.string().max(60).nullish(),
      dueDate: data,
      paymentDate: data,
      clientPaymentDate: data,
      confirmedDate: data,
      invoiceUrl: z.string().max(500).nullish(),
      deleted: z.boolean().nullish(),
    })
    .optional(),
  subscription: z.looseObject({ id: z.string().min(1).max(100) }).optional(),
});

export type AvisoDaAsaas =
  | {
      tipo: 'fatura';
      evento: string;
      nome: string;
      fatura: string;
      assinatura: string;
      valorCentavos: number;
      situacao: InvoiceStatus;
      vencimento: string;
      pagaEm: string | null;
      link: string | null;
    }
  | { tipo: 'assinatura_encerrada'; evento: string; nome: string; assinatura: string }
  | { tipo: 'ignorado'; motivo: string };

/** O que um aviso da Asaas pede, ou por que não pede nada. */
export function interpretarAviso(corpo: unknown): AvisoDaAsaas {
  const analise = avisoSchema.safeParse(corpo);
  if (!analise.success) return { tipo: 'ignorado', motivo: 'aviso fora do formato da Asaas' };
  const { id, event, payment, subscription } = analise.data;

  if (event === 'SUBSCRIPTION_DELETED' || event === 'SUBSCRIPTION_INACTIVATED') {
    if (subscription === undefined) return { tipo: 'ignorado', motivo: 'aviso sem a assinatura' };
    return { tipo: 'assinatura_encerrada', evento: id, nome: event, assinatura: subscription.id };
  }

  if (!event.startsWith('PAYMENT_')) return { tipo: 'ignorado', motivo: `evento ${event}` };
  if (payment === undefined) return { tipo: 'ignorado', motivo: 'aviso sem a cobrança' };
  if (payment.subscription == null || payment.subscription === '') {
    return { tipo: 'ignorado', motivo: 'cobrança avulsa, fora de assinatura' };
  }

  const situacao =
    event === 'PAYMENT_DELETED' || payment.deleted === true
      ? 'canceled'
      : situacaoDaFatura(payment.status ?? '');
  if (situacao === null) {
    return { tipo: 'ignorado', motivo: `situação ${payment.status ?? 'vazia'}` };
  }
  if (payment.dueDate == null) return { tipo: 'ignorado', motivo: 'cobrança sem vencimento' };

  const link =
    payment.invoiceUrl != null && /^https?:\/\//.test(payment.invoiceUrl)
      ? payment.invoiceUrl
      : null;

  return {
    tipo: 'fatura',
    evento: id,
    nome: event,
    fatura: payment.id,
    assinatura: payment.subscription,
    valorCentavos: centavosDaAsaas(payment.value ?? 0),
    situacao,
    vencimento: payment.dueDate,
    pagaEm:
      situacao === 'paid'
        ? (payment.clientPaymentDate ?? payment.paymentDate ?? payment.confirmedDate ?? null)
        : null,
    link,
  };
}

// -------------------------------------------------- a situação, para a tela

export interface SituacaoDaCobranca {
  emDia: boolean;
  /** Último dia liberado ("AAAA-MM-DD"), já com a tolerância. */
  liberadoAte: string | null;
  testeAte: string;
  assinatura: SubscriptionStatus | null;
  planoId: string | null;
  planoNome: string | null;
  valorCentavos: number | null;
  pagoAte: string | null;
  inadimplenteDesde: string | null;
  canceladaEm: string | null;
  /** Os limites em vigor são os do plano marcado para o teste. */
  limitesDoTeste: boolean;
  limiteLojas: number | null;
  limiteAparelhos: number | null;
  limiteCampanhasMes: number | null;
  /** Hoje, em Brasília, pela mesma régua do banco. */
  hoje: string;
}

/** Com quantos dias de antecedência o fim do teste começa a ser lembrado. */
const AVISAR_TESTE_COM_DIAS = 7;

/** O que a faixa diz — ou nada, quando não há o que fazer. */
export function avisoDaCobranca(
  situacao: SituacaoDaCobranca,
): { grave: boolean; texto: string; acao: string } | null {
  if (!situacao.emDia) {
    const motivo =
      situacao.assinatura === null
        ? 'O período de teste acabou.'
        : situacao.assinatura === 'canceled'
          ? 'A assinatura foi cancelada.'
          : situacao.assinatura === 'pending'
            ? 'A primeira fatura ainda não foi paga.'
            : 'Há uma fatura em atraso.';
    return {
      grave: true,
      texto: `${motivo} Campanhas, publicação de mudanças e lojas novas estão parados. O app continua funcionando para os seus clientes.`,
      acao: situacao.assinatura === null ? 'Escolher um plano' : 'Ver plano e cobrança',
    };
  }

  if (situacao.assinatura === null) {
    const dias = diasEntre(situacao.hoje, situacao.testeAte);
    if (dias > AVISAR_TESTE_COM_DIAS) return null;
    return {
      grave: false,
      texto:
        dias === 0
          ? 'Seu teste grátis acaba hoje.'
          : dias === 1
            ? 'Seu teste grátis acaba amanhã.'
            : `Seu teste grátis acaba em ${String(dias)} dias (${formatarDia(situacao.testeAte)}).`,
      acao: 'Escolher um plano',
    };
  }

  const pagueAte =
    situacao.liberadoAte === null
      ? ''
      : ` Pague até ${formatarDia(situacao.liberadoAte)} para nada parar.`;
  if (situacao.assinatura === 'past_due') {
    return { grave: false, texto: `Há uma fatura em atraso.${pagueAte}`, acao: 'Pagar a fatura' };
  }
  if (situacao.assinatura === 'pending' && situacao.hoje > situacao.testeAte) {
    return {
      grave: false,
      texto: `O teste acabou e a primeira fatura está em aberto.${pagueAte}`,
      acao: 'Pagar a fatura',
    };
  }
  return null;
}

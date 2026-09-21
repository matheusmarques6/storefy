/**
 * As automações de push (tela C09 do plano).
 *
 * Só entra aqui a automação que funciona DE PONTA A PONTA: gatilho de verdade,
 * destinatário de verdade, envio de verdade. "De volta ao estoque" e "inativo
 * há 7 dias" ainda não têm gatilho, e por isso NÃO aparecem na tela — um card
 * "em breve" é exatamente o que a regra 3 do CLAUDE.md proíbe.
 *
 * O texto sugerido de cada uma é ponto de partida editável, e não dado
 * inventado: nada dele vira linha no banco antes de o lojista salvar.
 */
import { z } from 'zod';
import { MAXIMO_DO_CORPO, MAXIMO_DO_TITULO } from '@/lib/campanha';

/** Os tipos que funcionam de ponta a ponta hoje. */
export const TIPOS_DE_AUTOMACAO = ['welcome', 'abandoned_cart', 'order_shipped'] as const;
export type TipoDeAutomacao = (typeof TIPOS_DE_AUTOMACAO)[number];

export function ehTipoDeAutomacao(valor: unknown): valor is TipoDeAutomacao {
  return typeof valor === 'string' && (TIPOS_DE_AUTOMACAO as readonly string[]).includes(valor);
}

export interface DescricaoDoTipo {
  nome: string;
  /** O que dispara, em uma frase que o lojista entende. */
  gatilho: string;
  /** Por que vale a pena ligar. */
  porque: string;
  /** Como o campo de atraso se chama nesta automação. */
  rotuloDoAtraso: string;
  sugestao: { title: string; body: string; delayMinutes: number };
}

export const DESCRICAO_DO_TIPO: Record<TipoDeAutomacao, DescricaoDoTipo> = {
  welcome: {
    nome: 'Boas-vindas',
    gatilho: 'Quando alguém instala o app e aceita receber notificações.',
    porque:
      'A primeira mensagem é a que mais abre. Use para apresentar a loja ou dar um cupom de estreia.',
    rotuloDoAtraso: 'Enviar depois de',
    sugestao: {
      title: 'Bem-vindo!',
      body: 'Que bom ter você aqui. Dá uma olhada nas novidades da semana.',
      delayMinutes: 10,
    },
  },
  abandoned_cart: {
    nome: 'Carrinho abandonado',
    gatilho: 'Quando o cliente põe algo no carrinho e não finaliza a compra.',
    porque:
      'É a automação que mais traz venda de volta. O envio é cancelado sozinho se a compra acontecer antes.',
    rotuloDoAtraso: 'Esperar antes de enviar',
    sugestao: {
      title: 'Esqueceu algo?',
      body: 'Seu carrinho continua aqui. Finalize antes que acabe.',
      delayMinutes: 60,
    },
  },
  order_shipped: {
    nome: 'Pedido enviado',
    gatilho: 'Quando você marca o pedido como enviado na Shopify.',
    porque:
      'É a notificação que o cliente QUER receber, e a que mais faz ele abrir o app de novo depois da compra. Só vai para quem comprou pelo app: quem comprou pelo site não tem para onde receber.',
    rotuloDoAtraso: 'Avisar depois de',
    sugestao: {
      title: 'Seu pedido saiu para entrega',
      body: 'Acompanhe a entrega por aqui. Qualquer coisa, é só chamar a gente.',
      delayMinutes: 0,
    },
  },
};

/** O mesmo limite do banco (`delay_minutes between 0 and 10080`). */
export const ATRASO_MAXIMO_MINUTOS = 7 * 24 * 60;

export const FormularioDaAutomacao = z.object({
  title: z
    .string()
    .trim()
    .min(1, { message: 'Escreva um título.' })
    .max(MAXIMO_DO_TITULO, {
      message: `O título passa de ${String(MAXIMO_DO_TITULO)} caracteres.`,
    }),
  body: z
    .string()
    .trim()
    .min(1, { message: 'Escreva a mensagem.' })
    .max(MAXIMO_DO_CORPO, {
      message: `A mensagem passa de ${String(MAXIMO_DO_CORPO)} caracteres.`,
    }),
  deepLink: z.string().trim().optional(),
  delayMinutes: z
    .number()
    .int({ message: 'Use minutos inteiros.' })
    .min(0, { message: 'O atraso não pode ser negativo.' })
    .max(ATRASO_MAXIMO_MINUTOS, { message: 'O atraso máximo é de 7 dias.' }),
  enabled: z.boolean(),
});

export type DadosDaAutomacao = z.infer<typeof FormularioDaAutomacao>;

/**
 * O atraso em texto de gente.
 *
 * "60 minutos" é o que o banco guarda; "1 hora" é o que o lojista pensa. Ele
 * precisa reconhecer de relance o que configurou, porque é a diferença entre
 * um push uma hora depois do carrinho e um push um minuto depois.
 */
export function descricaoDoAtraso(minutos: number): string {
  if (!Number.isFinite(minutos) || minutos < 0) return '—';
  const inteiro = Math.trunc(minutos);

  if (inteiro === 0) return 'na hora';
  if (inteiro < 60) return inteiro === 1 ? '1 minuto' : `${String(inteiro)} minutos`;

  if (inteiro % (24 * 60) === 0) {
    const dias = inteiro / (24 * 60);
    return dias === 1 ? '1 dia' : `${String(dias)} dias`;
  }
  if (inteiro % 60 === 0) {
    const horas = inteiro / 60;
    return horas === 1 ? '1 hora' : `${String(horas)} horas`;
  }

  const horas = Math.floor(inteiro / 60);
  const resto = inteiro % 60;
  const parteDaHora = horas === 1 ? '1 hora' : `${String(horas)} horas`;
  const parteDoMinuto = resto === 1 ? '1 minuto' : `${String(resto)} minutos`;
  return `${parteDaHora} e ${parteDoMinuto}`;
}

/** As opções de atraso que a tela oferece, em vez de um campo livre. */
export const ATRASOS_SUGERIDOS: { minutos: number; rotulo: string }[] = [
  { minutos: 0, rotulo: 'Na hora' },
  { minutos: 10, rotulo: '10 minutos' },
  { minutos: 30, rotulo: '30 minutos' },
  { minutos: 60, rotulo: '1 hora' },
  { minutos: 180, rotulo: '3 horas' },
  { minutos: 360, rotulo: '6 horas' },
  { minutos: 1440, rotulo: '1 dia' },
  { minutos: 4320, rotulo: '3 dias' },
];

export interface ProblemaDaAutomacao {
  campo: 'title' | 'body' | 'deepLink' | 'delayMinutes';
  mensagem: string;
}

export function validarAutomacao(
  dados: unknown,
): { ok: true; valores: DadosDaAutomacao } | { ok: false; problemas: ProblemaDaAutomacao[] } {
  const analise = FormularioDaAutomacao.safeParse(dados);
  if (analise.success) return { ok: true, valores: analise.data };

  return {
    ok: false,
    problemas: analise.error.issues.map((questao) => ({
      campo: (questao.path[0] as ProblemaDaAutomacao['campo'] | undefined) ?? 'title',
      mensagem: questao.message,
    })),
  };
}

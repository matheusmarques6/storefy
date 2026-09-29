/**
 * As regras das campanhas de push (telas C07 a C10 do plano).
 *
 * Separado das telas porque é aqui que mora o que não pode dar errado: uma
 * notificação sai para o celular de milhares de clientes e NÃO TEM VOLTA. Não
 * há "desfazer", não há correção de erro de digitação depois do envio, e um
 * link quebrado é um toque desperdiçado de cada pessoa que abriu.
 *
 * Os limites de tamanho não são estéticos. iOS e Android cortam o texto na
 * notificação, e o lojista precisa ver o corte ANTES de enviar, não depois.
 */
import { z } from 'zod';
import { instanteDaHoraLocal } from '@/lib/fuso';

/** O mesmo limite do banco (`char_length(trim(title)) between 1 and 120`). */
export const MAXIMO_DO_TITULO = 120;
export const MAXIMO_DO_CORPO = 400;

/**
 * Onde cada sistema corta o texto na tela bloqueada.
 *
 * Números da prática, não da documentação: os dois sistemas cortam por LARGURA
 * e não por número de caracteres, e variam com o tamanho de fonte que a pessoa
 * escolheu. Estes são os pontos em que o corte já aconteceu em qualquer
 * aparelho, e servem para avisar o lojista, não para impedi-lo.
 */
export const CORTE_IOS_TITULO = 38;
export const CORTE_IOS_CORPO = 110;
export const CORTE_ANDROID_TITULO = 45;
export const CORTE_ANDROID_CORPO = 120;

export type StatusDaCampanha = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'canceled';

/** Como cada status aparece para o lojista, em pt-BR e sem jargão. */
export const ROTULO_DO_STATUS: Record<StatusDaCampanha, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  sending: 'Enviando',
  sent: 'Enviada',
  failed: 'Falhou',
  canceled: 'Cancelada',
};

export const EXPLICACAO_DO_STATUS: Record<StatusDaCampanha, string> = {
  draft: 'Ainda não saiu. Você pode editar à vontade.',
  scheduled: 'Vai sair no horário marcado. Dá para cancelar até lá.',
  sending: 'Saindo agora. Isso leva alguns instantes.',
  sent: 'Já chegou nos celulares dos seus clientes.',
  failed: 'Não conseguimos enviar. Veja o motivo e tente de novo.',
  canceled: 'Você cancelou antes de sair.',
};

/**
 * Uma campanha enviada não volta atrás — nem para editar, nem para apagar.
 *
 * Deixar editar depois do envio criaria a pior confusão possível: o histórico
 * mostraria um texto que ninguém recebeu.
 */
export function podeEditar(status: StatusDaCampanha): boolean {
  return status === 'draft' || status === 'scheduled';
}

/** Só dá para cancelar o que ainda não saiu. */
export function podeCancelar(status: StatusDaCampanha): boolean {
  return status === 'scheduled';
}

/** Excluir é para o que nunca chegou a ninguém. */
export function podeExcluir(status: StatusDaCampanha): boolean {
  return status === 'draft' || status === 'canceled' || status === 'failed';
}

/** Quanto tempo de antecedência exigimos de um agendamento. */
export const ANTECEDENCIA_MINIMA_MS = 5 * 60 * 1000;

/**
 * O formulário da nova campanha (C08).
 *
 * `deepLink` é caminho da própria loja, nunca URL inteira: a mesma razão do
 * lado do app — uma notificação que abre host de terceiro dentro do app, sem
 * barra de endereço, é uma tela de phishing com a cara da loja.
 */
export const FormularioDaCampanha = z.object({
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
  /** A hora de relógio do `datetime-local` ("2026-09-30T20:00"), no fuso da loja. */
  agendarPara: z.string().trim().optional(),
  /**
   * O que o lojista marcou em "Quando enviar". `false` é "Agendar para", e aí
   * o horário é OBRIGATÓRIO: vazio não pode virar "agora". Era o que
   * acontecia — quem marcava "Agendar" e esquecia a data mandava a campanha
   * para todo mundo na mesma hora. Ausente (o rascunho), o horário nem entra
   * na conta.
   */
  enviarAgora: z.boolean().optional(),
});

export type DadosDaCampanha = z.infer<typeof FormularioDaCampanha>;

export interface ProblemaNoFormulario {
  campo: 'title' | 'body' | 'deepLink' | 'agendarPara';
  mensagem: string;
}

/**
 * Normaliza o caminho que o toque vai abrir.
 *
 * Aceita o que o lojista realmente digita — `/promocoes`, `promocoes`, e até a
 * URL inteira da própria loja copiada do navegador — e recusa o que apontaria
 * para fora. Vazio é válido: uma campanha sem link abre o app, e é isso mesmo.
 */
export function normalizarDeepLink(
  entrada: string | undefined,
  urlDaLoja: string,
): { ok: true; caminho: string | null } | { ok: false; mensagem: string } {
  const bruto = (entrada ?? '').trim();
  if (bruto === '') return { ok: true, caminho: null };

  let alvo: URL;
  let base: URL;
  try {
    base = new URL(urlDaLoja);
    alvo = new URL(bruto, urlDaLoja);
  } catch {
    return { ok: false, mensagem: 'Este endereço não parece válido.' };
  }

  if (alvo.protocol !== 'http:' && alvo.protocol !== 'https:') {
    return { ok: false, mensagem: 'Use um endereço da sua loja, começando com /.' };
  }

  const host = alvo.hostname.toLowerCase();
  const raiz = base.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== raiz && !host.endsWith(`.${raiz}`)) {
    return {
      ok: false,
      mensagem: 'O link precisa ser de uma página da sua loja. Cole só o caminho, como /promocoes.',
    };
  }

  return { ok: true, caminho: `${alvo.pathname}${alvo.search}${alvo.hash}` };
}

/**
 * Interpreta o horário do agendamento.
 *
 * `null` quer dizer "enviar agora", que é diferente de "horário inválido" — e
 * confundir os dois faria uma campanha agendada para uma data ilegível sair na
 * hora, para todo mundo.
 */
export function interpretarAgendamento(
  entrada: string | undefined,
  agoraMs: number,
  fuso: string,
): { ok: true; quando: Date | null } | { ok: false; mensagem: string } {
  const bruto = (entrada ?? '').trim();
  if (bruto === '') return { ok: true, quando: null };

  /*
   * A hora de relógio é lida NO FUSO DA LOJA. Era `new Date(bruto)`, que lê
   * string sem fuso no fuso do processo — UTC na Vercel —, e toda campanha
   * agendada saía três horas antes. Os testes não pegavam porque passavam
   * "…T15:00:00.000Z", com um `Z` que o `datetime-local` nunca manda.
   */
  const quando = instanteDaHoraLocal(bruto, fuso);
  if (quando === null) {
    return { ok: false, mensagem: 'Escolha uma data e um horário.' };
  }
  if (quando.getTime() < agoraMs + ANTECEDENCIA_MINIMA_MS) {
    return {
      ok: false,
      mensagem: 'Escolha um horário pelo menos 5 minutos à frente, para dar tempo de preparar.',
    };
  }

  return { ok: true, quando };
}

/** Valida o formulário inteiro e devolve os problemas por campo. */
export function validarCampanha(
  dados: unknown,
  /** `fuso` é o da LOJA: a hora de um push é a hora dos clientes dela. */
  contexto: { urlDaLoja: string; agoraMs: number; fuso: string },
):
  | {
      ok: true;
      valores: { title: string; body: string; deepLink: string | null; agendarPara: Date | null };
    }
  | { ok: false; problemas: ProblemaNoFormulario[] } {
  const analise = FormularioDaCampanha.safeParse(dados);
  if (!analise.success) {
    return {
      ok: false,
      problemas: analise.error.issues.map((questao) => ({
        campo: (questao.path[0] as ProblemaNoFormulario['campo'] | undefined) ?? 'title',
        mensagem: questao.message,
      })),
    };
  }

  const problemas: ProblemaNoFormulario[] = [];

  const link = normalizarDeepLink(analise.data.deepLink, contexto.urlDaLoja);
  if (!link.ok) problemas.push({ campo: 'deepLink', mensagem: link.mensagem });

  // "Agora" ignora a data que tenha sobrado no campo de uma escolha anterior.
  const horario = analise.data.enviarAgora === true ? '' : (analise.data.agendarPara ?? '');
  const agenda =
    analise.data.enviarAgora === false && horario === ''
      ? ({ ok: false, mensagem: 'Escolha a data e o horário do envio.' } as const)
      : interpretarAgendamento(horario, contexto.agoraMs, contexto.fuso);
  if (!agenda.ok) problemas.push({ campo: 'agendarPara', mensagem: agenda.mensagem });

  if (problemas.length > 0) return { ok: false, problemas };
  if (!link.ok || !agenda.ok) return { ok: false, problemas };

  return {
    ok: true,
    valores: {
      title: analise.data.title,
      body: analise.data.body,
      deepLink: link.caminho,
      agendarPara: agenda.quando,
    },
  };
}

/** Como o texto aparece na tela bloqueada, já cortado como o sistema corta. */
export function previaDaNotificacao(
  texto: string,
  limite: number,
): { texto: string; cortado: boolean } {
  const limpo = texto.trim();
  if (limpo.length <= limite) return { texto: limpo, cortado: false };
  return { texto: `${limpo.slice(0, limite).trimEnd()}…`, cortado: true };
}

/**
 * As métricas de uma campanha, a partir do que o job de estatísticas gravou.
 *
 * `null` significa "ainda não sabemos", e a tela mostra um traço. NUNCA zero:
 * "0 aberturas" é uma afirmação sobre o desempenho da campanha, e dizê-la
 * quando o número ainda não chegou faria o lojista concluir que a campanha
 * fracassou (regra 1 do CLAUDE.md).
 */
export interface MetricasDaCampanha {
  enviados: number | null;
  entregues: number | null;
  abertos: number | null;
  falhas: number | null;
  /** Aberturas sobre entregues, de 0 a 1. `null` quando falta algum dos dois. */
  taxaDeAbertura: number | null;
}

function inteiroOuNulo(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0
    ? Math.trunc(valor)
    : null;
}

export function lerMetricas(stats: unknown): MetricasDaCampanha {
  const bruto =
    stats !== null && typeof stats === 'object' ? (stats as Record<string, unknown>) : {};

  const enviados = inteiroOuNulo(bruto.enviados);
  const entregues = inteiroOuNulo(bruto.entregues);
  const abertos = inteiroOuNulo(bruto.abertos);
  const falhas = inteiroOuNulo(bruto.falhas);

  // Sem entregues não há taxa. Dividir por zero daria `Infinity` ou `NaN` na
  // tela, e inventar 0% seria pior ainda.
  const taxaDeAbertura =
    entregues !== null && entregues > 0 && abertos !== null ? abertos / entregues : null;

  return { enviados, entregues, abertos, falhas, taxaDeAbertura };
}

/** `null` vira traço; número vira número com separador de milhar. */
export function numeroOuTraco(valor: number | null): string {
  return valor === null ? '—' : valor.toLocaleString('pt-BR');
}

/** `null` vira traço; fração vira porcentagem com uma casa. */
export function porcentagemOuTraco(valor: number | null): string {
  if (valor === null) return '—';
  return `${(valor * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

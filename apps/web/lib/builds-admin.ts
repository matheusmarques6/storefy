/**
 * As decisões das telas A05 (fila de builds) e A06 (revisões das lojas).
 *
 * Fora dos componentes porque são decisões, não desenho — e duas delas custam
 * caro se estiverem erradas:
 *
 *   QUEM PODE SER REEXECUTADO. Reexecutar um build que ainda está rodando cria
 *   dois binários disputando o mesmo número de versão na loja, e a Apple
 *   recusa o segundo DEPOIS de gerar os dois. O botão não pode aparecer nesse
 *   estado, e a ação do servidor confere de novo.
 *
 *   QUANDO UMA REVISÃO ESTÁ PARADA. É a única coisa que a A06 existe para
 *   dizer: um app esperando a Apple há dois dias é normal, há doze não é, e
 *   ninguém descobre isso olhando uma lista ordenada por data.
 */
import type { BuildStatus } from '@storefy/db';

/** Os recortes da fila, na ordem em que aparecem na tela. */
export const FILTROS = ['problema', 'andamento', 'revisao', 'todos'] as const;
export type Filtro = (typeof FILTROS)[number];

export const ROTULO_DO_FILTRO: Record<Filtro, string> = {
  problema: 'Com problema',
  andamento: 'Em andamento',
  revisao: 'Na loja',
  todos: 'Todos',
};

/**
 * O filtro pedido na URL.
 *
 * O padrão é `problema`, e não `todos`: quem abre a fila de builds do admin
 * está atrás do que quebrou. Abrir em "todos" numa plataforma com trezentos
 * builds enterra os cinco que importam.
 */
export function lerFiltro(bruto: string | undefined): Filtro {
  return FILTROS.includes(bruto as Filtro) ? (bruto as Filtro) : 'problema';
}

/** Os status de cada recorte. `null` quer dizer "não filtra nada". */
export function statusDoFiltro(filtro: Filtro): BuildStatus[] | null {
  switch (filtro) {
    case 'problema':
      return ['errored', 'rejected'];
    case 'andamento':
      return ['queued', 'building'];
    case 'revisao':
      return ['submitted', 'in_review'];
    case 'todos':
      return null;
  }
}

/** A plataforma, o outro recorte da fila. Ausente é "as duas". */
export const PLATAFORMAS_DO_FILTRO = ['ios', 'android'] as const;
export type PlataformaDoFiltro = (typeof PLATAFORMAS_DO_FILTRO)[number];

export const ROTULO_DA_PLATAFORMA: Record<PlataformaDoFiltro, string> = {
  ios: 'iOS',
  android: 'Android',
};

export function lerPlataforma(bruto: string | undefined): PlataformaDoFiltro | null {
  return PLATAFORMAS_DO_FILTRO.find((plataforma) => plataforma === bruto) ?? null;
}

/**
 * O cliente da URL (`?org=`), vindo do detalhe da organização (A04).
 *
 * Só um uuid: o valor entra num filtro do PostgREST, e um texto qualquer ali
 * viraria erro 400 — a tela quebrada em vez de "nenhum build".
 */
export function lerOrganizacao(bruto: string | undefined): string | null {
  const valor = (bruto ?? '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(valor)
    ? valor
    : null;
}

/**
 * Dá para reexecutar?
 *
 * Só o que já parou e parou mal. `finished` e `approved` não se reexecutam
 * porque deram certo; `queued` e `building` não porque ainda estão rodando, e
 * um segundo build em paralelo é o bug descrito no topo deste arquivo.
 *
 * `submitted` e `in_review` ficam de fora por um motivo diferente: o binário
 * está com a Apple ou com a Google. Gerar outro não cancela a revisão em
 * curso — cria uma segunda, e as duas brigam pelo mesmo número de versão.
 */
export function podeReexecutar(status: BuildStatus): boolean {
  return status === 'errored' || status === 'canceled';
}

/** Na fila há mais que isto, algo parou: o workflow nem chegou a começar. */
export const MINUTOS_NA_FILA = 30;
/** Gerando há mais que isto, algo parou: um build normal termina em menos de uma hora. */
export const HORAS_GERANDO = 3;

export interface BuildEmAndamento {
  status: BuildStatus;
  criadoEm: string;
  /** Quando saiu da fila (`builds.started_at`). */
  iniciadoEm: string | null;
}

/**
 * Há quanto tempo, em minutos, o build está parado no estado em que está:
 * desde a criação na fila, desde o começo gerando. `null` fora dos dois.
 */
function minutosNoEstado(build: BuildEmAndamento, agora: number): number | null {
  const desde =
    build.status === 'queued'
      ? build.criadoEm
      : build.status === 'building'
        ? (build.iniciadoEm ?? build.criadoEm)
        : null;
  if (desde === null) return null;
  const quando = Date.parse(desde);
  if (Number.isNaN(quando)) return null;
  return Math.max(0, Math.floor((agora - quando) / 60_000));
}

/**
 * O build parou no meio? "Na fila" ou "gerando" há tempo demais: o workflow
 * morreu antes de chegar à EAS, ou o disparo falhou e a marca de erro não
 * gravou. Sem saída, ele trava a loja — ninguém publica com um em andamento,
 * e o reexecutar só aceita o que falhou.
 *
 * Não há prazo automático, de propósito: um build que só está demorando
 * (a fila da EAS num dia cheio) e fosse encerrado sozinho abriria caminho
 * para um segundo, disputando o mesmo número de versão. Quem encerra é a
 * equipe, olhando os logs (A05).
 */
export function buildParado(build: BuildEmAndamento, agora: number = Date.now()): boolean {
  const minutos = minutosNoEstado(build, agora);
  if (minutos === null) return false;
  return build.status === 'queued' ? minutos > MINUTOS_NA_FILA : minutos > HORAS_GERANDO * 60;
}

/**
 * O agora e os prazos do "parado" para uma consulta: a lista filtra no banco
 * com os mesmos limites que `buildParado` usa na tela.
 */
export function prazosDoParado(agora: number = Date.now()): {
  agora: number;
  limiteDaFila: string;
  limiteGerando: string;
} {
  return {
    agora,
    limiteDaFila: new Date(agora - MINUTOS_NA_FILA * 60_000).toISOString(),
    limiteGerando: new Date(agora - HORAS_GERANDO * 3_600_000).toISOString(),
  };
}

/** "na fila há 45 min", "gerando há 4 h": o que a A05 mostra do build parado. */
export function descricaoDoParado(build: BuildEmAndamento, agora: number = Date.now()): string {
  const minutos = minutosNoEstado(build, agora) ?? 0;
  const tempo = minutos < 60 ? `${String(minutos)} min` : `${String(Math.floor(minutos / 60))} h`;
  return `${build.status === 'queued' ? 'Na fila' : 'Gerando'} há ${tempo}`;
}

/** O motivo que o lojista lê no histórico, depois que a equipe encerra o build. */
export const MOTIVO_DO_PARADO =
  'A geração parou no meio e foi encerrada pela equipe da Storefy. Publique de novo quando quiser.';

/** Há quantos dias este build foi enviado para a loja. */
export function diasEsperando(enviadoEm: string | null, agora: number = Date.now()): number | null {
  if (enviadoEm == null || enviadoEm === '') return null;

  const quando = Date.parse(enviadoEm);
  if (Number.isNaN(quando)) return null;

  // Futuro vira zero, e não negativo: relógio torto não é "esperando há -1 dia".
  return Math.max(0, Math.floor((agora - quando) / 86_400_000));
}

/**
 * A partir de quantos dias uma revisão deixa de ser normal.
 *
 * A Apple responde em 24 a 48 horas na maioria das vezes; a Google costuma ser
 * mais rápida. Sete dias é folgado de propósito — um alerta que dispara cedo
 * demais vira ruído, e um alerta que ninguém lê é o mesmo que não ter alerta.
 */
export const DIAS_ATE_ESTRANHAR = 7;

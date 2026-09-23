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

/**
 * O aviso de uma revisão parada, ou `null` quando não há o que avisar.
 *
 * Só `submitted` e `in_review` esperam alguém de fora. Um build rejeitado não
 * está parado: está esperando NÓS, e quem diz isso é o status, não o tempo.
 */
export function revisaoParada(
  status: BuildStatus,
  enviadoEm: string | null,
  agora: number = Date.now(),
): string | null {
  if (status !== 'submitted' && status !== 'in_review') return null;

  const dias = diasEsperando(enviadoEm, agora);
  if (dias == null || dias < DIAS_ATE_ESTRANHAR) return null;

  return `Parado há ${String(dias)} dias. Vale abrir um chamado na loja.`;
}

/**
 * O que é novo na caixa de avisos (M07 do plano).
 *
 * "Lista as campanhas enviadas pela API da Storefy e controla lidas/não lidas
 * LOCALMENTE." O servidor diz o que foi enviado; o que este cliente já leu
 * fica no aparelho dele e não sobe para lugar nenhum — ninguém precisa saber
 * o que ele abriu, e guardar isso no servidor seria dado pessoal sem uso.
 *
 * A junção das duas metades mora aqui, separada da tela, porque é onde mora o
 * erro chato: um badge de "3 não lidas" que não zera, ou que conta avisos que
 * o cliente já abriu semana passada.
 */
import type { AvisoDaCaixa } from './api.ts';
import type { EstadoDasNotificacoes } from './ajustes.ts';

export interface AvisoNaTela extends AvisoDaCaixa {
  lido: boolean;
}

/** Marca cada aviso como lido ou não, do mais novo para o mais velho. */
export function montarCaixa(
  avisos: readonly AvisoDaCaixa[],
  lidos: readonly string[],
): AvisoNaTela[] {
  const jaLidos = new Set(lidos);
  return [...avisos]
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
    .map((aviso) => ({ ...aviso, lido: jaLidos.has(aviso.id) }));
}

/** Quantos avisos ainda não foram abertos. É o número do badge. */
export function naoLidos(avisos: readonly AvisoNaTela[]): number {
  return avisos.filter((aviso) => !aviso.lido).length;
}

/**
 * Acrescenta um id à lista de lidos.
 *
 * A lista é podada para os ids que ainda existem na caixa: sem isso ela
 * cresceria para sempre no disco do cliente, guardando ids de campanhas que o
 * servidor já nem devolve.
 */
export function marcarLido(
  lidos: readonly string[],
  id: string,
  avisos: readonly AvisoDaCaixa[],
): string[] {
  const existentes = new Set(avisos.map((aviso) => aviso.id));
  existentes.add(id);
  return [...new Set([...lidos, id])].filter((lido) => existentes.has(lido));
}

/** Marca tudo que está na caixa como lido. */
export function marcarTodosLidos(avisos: readonly AvisoDaCaixa[]): string[] {
  return avisos.map((aviso) => aviso.id);
}

/**
 * Lê a lista de lidos guardada no disco, tolerando qualquer lixo.
 *
 * Um `JSON.parse` que lance aqui deixaria a aba de avisos sem abrir. Perder a
 * marcação de lidos é irritante; a aba não abrir é um bug.
 */
export function lerLidos(bruto: string | null): string[] {
  if (bruto === null || bruto.trim() === '') return [];
  try {
    const lido: unknown = JSON.parse(bruto);
    if (!Array.isArray(lido)) return [];
    return lido.filter((item): item is string => typeof item === 'string' && item !== '');
  } catch {
    return [];
  }
}

/**
 * Quando o aviso chegou, em texto para o cliente.
 *
 * Nada de "19/09/2026 12:00" numa caixa de notificação: "há 2 horas" é o que
 * a pessoa quer saber, e é o que todo app que ela já usa mostra.
 */
export function quandoChegou(sentAt: string, agoraMs: number): string {
  const quando = Date.parse(sentAt);
  if (Number.isNaN(quando)) return '';

  const minutos = Math.floor((agoraMs - quando) / 60_000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${String(minutos)} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${String(horas)} h`;

  const dias = Math.floor(horas / 24);
  if (dias === 1) return 'ontem';
  if (dias < 7) return `há ${String(dias)} dias`;

  const semanas = Math.floor(dias / 7);
  if (semanas < 5) return semanas === 1 ? 'há 1 semana' : `há ${String(semanas)} semanas`;

  const meses = Math.floor(dias / 30);
  return meses <= 1 ? 'há 1 mês' : `há ${String(meses)} meses`;
}

/* ------------------------------------------------ a caixa sem internet */

/**
 * Quantos avisos o aparelho guarda para mostrar sem internet: os mais novos.
 * A caixa guardada é o que a tela mostra enquanto o servidor não responde —
 * e o que ela continua mostrando, com um aviso, quando ele não responde.
 */
export const AVISOS_GUARDADOS = 50;

export function avisosParaGuardar(avisos: readonly AvisoDaCaixa[]): AvisoDaCaixa[] {
  return [...avisos]
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
    .slice(0, AVISOS_GUARDADOS);
}

function ehAviso(item: unknown): item is AvisoDaCaixa {
  if (item === null || typeof item !== 'object') return false;
  const aviso = item as Record<string, unknown>;
  return (
    typeof aviso.id === 'string' &&
    aviso.id !== '' &&
    typeof aviso.title === 'string' &&
    typeof aviso.body === 'string' &&
    typeof aviso.sentAt === 'string' &&
    (aviso.deepLink === null || typeof aviso.deepLink === 'string') &&
    (aviso.imagePath === null || typeof aviso.imagePath === 'string')
  );
}

/**
 * Lê a caixa guardada, tolerando qualquer lixo. `null` é "nada guardado" —
 * diferente de `[]`, a caixa que estava vazia da última vez. Um aviso fora do
 * formato (de uma versão antiga do app) fica de fora, e o resto aparece.
 */
export function lerCaixaGuardada(bruto: string | null): AvisoDaCaixa[] | null {
  if (bruto === null || bruto.trim() === '') return null;
  try {
    const lido: unknown = JSON.parse(bruto);
    if (!Array.isArray(lido)) return null;
    return lido.filter(ehAviso);
  } catch {
    return null;
  }
}

/**
 * O que a caixa mostra:
 *
 *   `pronta`       — a lista (vazia, se a loja ainda não mandou nada);
 *   `carregando`   — a primeira leitura, sem nada guardado para mostrar;
 *   `erro`         — a leitura falhou e não há nada guardado: dizer "nenhum
 *                    aviso" ali seria mentir, porque pode haver;
 *   `desligada`    — o cliente não ligou as notificações: a caixa é da
 *                    inscrição dele, e sem ela não há o que buscar;
 *   `bloqueada`    — recusadas nos ajustes do celular;
 *   `indisponivel` — este app não fala com a Storefy (build sem credencial).
 *
 * O que já está na tela ganha de tudo: uma lista guardada continua à vista
 * mesmo sem internet, com o aviso de `caixaDesatualizada`.
 */
export type SituacaoDaCaixa =
  'pronta' | 'carregando' | 'erro' | 'desligada' | 'bloqueada' | 'indisponivel';

export function situacaoDaCaixa(estado: {
  notificacoes: EstadoDasNotificacoes;
  comCredenciais: boolean;
  temAvisos: boolean;
  /** Já há uma resposta: do servidor, ou a caixa guardada no aparelho. */
  jaLeu: boolean;
  /** A última leitura do servidor falhou. */
  falhou: boolean;
}): SituacaoDaCaixa {
  if (estado.temAvisos) return 'pronta';
  if (estado.notificacoes === 'indisponivel' || !estado.comCredenciais) return 'indisponivel';
  if (estado.notificacoes === 'carregando') return 'carregando';
  if (estado.notificacoes === 'bloqueadas') return 'bloqueada';
  if (estado.notificacoes === 'desligadas') return 'desligada';
  if (estado.falhou) return 'erro';
  return estado.jaLeu ? 'pronta' : 'carregando';
}

/** A lista na tela é a guardada, e o servidor não respondeu: vale avisar. */
export function caixaDesatualizada(estado: { temAvisos: boolean; falhou: boolean }): boolean {
  return estado.temAvisos && estado.falhou;
}

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

/**
 * O que a página pública de status diz de cada parte do sistema (Fase 8).
 *
 * As rotinas automáticas falham em silêncio: se o cron para, nenhuma tela
 * quebra — as campanhas agendadas simplesmente não saem. A página transforma o
 * batimento de cada job (`job_heartbeats`) numa frase que o lojista entende:
 * "funcionando", "com atraso", "parado".
 *
 * O CRITÉRIO É O INTERVALO DE CADA JOB. O despacho roda a cada minuto; o
 * acompanhamento da revisão, a cada hora. Cinco minutos sem o despacho é
 * problema; cinco minutos sem a revisão é o normal.
 *
 * Função pura: a página só busca os dados, e o teste prova as fronteiras.
 */

export type EstadoDoComponente = 'operacional' | 'instavel' | 'parado' | 'aguardando';

export interface JobDoStatus {
  job: 'dispatch-push' | 'push-stats' | 'review-status' | 'analytics';
  nome: string;
  descricao: string;
  /** De quanto em quanto tempo o cron chama, em minutos (`vercel.json`). */
  intervaloMin: number;
}

/** Na ordem em que o lojista sente a falta de cada um. */
export const JOBS_DO_STATUS: readonly JobDoStatus[] = [
  {
    job: 'dispatch-push',
    nome: 'Envio de notificações',
    descricao: 'Campanhas agendadas, carrinho abandonado e boas-vindas.',
    intervaloMin: 1,
  },
  {
    job: 'push-stats',
    nome: 'Estatísticas das notificações',
    descricao: 'Entregas e aberturas de cada campanha.',
    intervaloMin: 15,
  },
  {
    job: 'analytics',
    nome: 'Números do painel',
    descricao: 'Vendas pelo app e aparelhos ativos, por dia.',
    intervaloMin: 60,
  },
  {
    job: 'review-status',
    nome: 'Acompanhamento da revisão',
    descricao: 'A aprovação do app na App Store e na Play Store.',
    intervaloMin: 60,
  },
];

export interface Batimento {
  ultimoSucesso: string | null;
  ultimaFalha: string | null;
  /** Desde quando falha sem parar; nulo quando a última deu certo. */
  falhandoDesde: string | null;
}

export interface SituacaoDoComponente {
  estado: EstadoDoComponente;
  detalhe: string;
}

const MINUTO = 60_000;

/** "há 5 minutos", "há 2 horas", "há 3 dias". */
export function haQuanto(ms: number): string {
  const minutos = Math.floor(Math.max(0, ms) / MINUTO);
  if (minutos < 1) return 'há menos de 1 minuto';
  if (minutos < 60) return minutos === 1 ? 'há 1 minuto' : `há ${String(minutos)} minutos`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return horas === 1 ? 'há 1 hora' : `há ${String(horas)} horas`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'há 1 dia' : `há ${String(dias)} dias`;
}

function instante(texto: string | null): number | null {
  if (texto === null) return null;
  const ms = Date.parse(texto);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * A situação de um job pelo batimento.
 *
 * - em dia: a última execução certa veio dentro de 3 intervalos (no mínimo 5
 *   minutos, porque o cron da Vercel às vezes atrasa um pouco);
 * - atrasado ou falhando agora: até 10 intervalos (no mínimo 30 minutos);
 * - parado: passou disso.
 */
export function situacaoDoJob(
  batimento: Batimento | undefined,
  intervaloMin: number,
  agoraMs: number,
): SituacaoDoComponente {
  const sucesso = instante(batimento?.ultimoSucesso ?? null);
  const falha = instante(batimento?.ultimaFalha ?? null);

  if (sucesso === null && falha === null) {
    return { estado: 'aguardando', detalhe: 'Ainda não rodou neste ambiente.' };
  }

  const emDia = Math.max(3 * intervaloMin, 5) * MINUTO;
  const tolerancia = Math.max(10 * intervaloMin, 30) * MINUTO;
  const falhouPorUltimo = falha !== null && (sucesso === null || falha > sucesso);

  if (falhouPorUltimo) {
    /*
     * Uma falha só é "a próxima tenta de novo". Falhando sem parar por mais
     * que a tolerância é parado — e o tempo conta de quando COMEÇOU a falhar,
     * e não da última tentativa, que é sempre recente enquanto o cron roda.
     */
    const desde = instante(batimento?.falhandoDesde ?? null) ?? falha;
    const falhando = agoraMs - desde;
    return falhando > tolerancia
      ? { estado: 'parado', detalhe: `Falhando ${haQuanto(falhando)}.` }
      : { estado: 'instavel', detalhe: 'A última execução falhou; a próxima tenta de novo.' };
  }

  // Aqui a última execução deu certo.
  const desdeOSucesso = agoraMs - (sucesso ?? agoraMs);
  if (desdeOSucesso <= emDia) {
    return { estado: 'operacional', detalhe: `Última execução ${haQuanto(desdeOSucesso)}.` };
  }
  if (desdeOSucesso <= tolerancia) {
    return {
      estado: 'instavel',
      detalhe: `Com atraso: última execução ${haQuanto(desdeOSucesso)}.`,
    };
  }
  return { estado: 'parado', detalhe: `Sem executar ${haQuanto(desdeOSucesso)}.` };
}

export const ROTULO_DO_ESTADO: Record<EstadoDoComponente, string> = {
  operacional: 'Funcionando',
  instavel: 'Instável',
  parado: 'Parado',
  aguardando: 'Aguardando',
};

/** A frase do topo da página, pelo pior componente. */
export function resumoDoStatus(estados: readonly EstadoDoComponente[]): {
  estado: EstadoDoComponente;
  frase: string;
} {
  if (estados.includes('parado')) {
    return { estado: 'parado', frase: 'Parte do sistema está parada.' };
  }
  if (estados.includes('instavel')) {
    return { estado: 'instavel', frase: 'Parte do sistema está com atraso ou instabilidade.' };
  }
  if (estados.length > 0 && estados.every((estado) => estado === 'aguardando')) {
    return { estado: 'aguardando', frase: 'As rotinas automáticas ainda não rodaram aqui.' };
  }
  return { estado: 'operacional', frase: 'Tudo funcionando.' };
}

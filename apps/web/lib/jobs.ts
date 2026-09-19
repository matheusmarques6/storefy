import 'server-only';

/**
 * O que é comum aos jobs do Vercel Cron.
 *
 * Duas coisas: conferir quem chamou, e decidir o que fazer com cada envio.
 * As duas ficam separadas das rotas porque as duas se erram em silêncio — um
 * job aberto deixa qualquer um disparar o push de todos os clientes, e uma
 * decisão errada de "tentar de novo" manda a campanha duas vezes.
 */
import { iguaisEmTempoConstante } from '@/lib/cripto';

/** O cabeçalho que o Vercel Cron envia. */
export const CABECALHO_DO_CRON = 'authorization';

export type Autorizacao = { ok: true } | { ok: false; status: number; motivo: string };

/**
 * O chamador é o nosso cron?
 *
 * Sem `CRON_SECRET` configurado a resposta é NÃO, sempre. Um job que roda sem
 * segredo é um endpoint público que dispara notificação para a base de todos
 * os clientes — e "ainda não configurei" não pode ser a porta de entrada
 * disso.
 */
export function autorizarJob(cabecalho: string | null, segredo: string | undefined): Autorizacao {
  if (segredo == null || segredo === '') {
    return { ok: false, status: 503, motivo: 'CRON_SECRET não configurado' };
  }

  const recebido = (cabecalho ?? '').trim();
  const esperado = `Bearer ${segredo}`;

  // Comparação em tempo constante: `===` para na primeira diferença, e isso
  // basta para descobrir o segredo caractere a caractere.
  if (!iguaisEmTempoConstante(recebido, esperado)) {
    return { ok: false, status: 401, motivo: 'segredo do cron não confere' };
  }

  return { ok: true };
}

/** O resumo que cada job devolve. Vai para o log da Vercel, não para o público. */
export interface ResumoDoJob {
  processados: number;
  enviados: number;
  falhas: number;
  /** Envios devolvidos à fila por queda de uma execução anterior. */
  destravados: number;
}

export const RESUMO_VAZIO: ResumoDoJob = {
  processados: 0,
  enviados: 0,
  falhas: 0,
  destravados: 0,
};

/**
 * O que fazer com um envio que não deu certo.
 *
 * Falha permanente (chave errada, corpo recusado) vira `falhar`: marcar e
 * seguir. Falha passageira vira `devolver`: a linha volta para a fila e o
 * próximo minuto tenta de novo.
 *
 * A distinção é o que separa uma loja mal configurada — que precisa que o
 * lojista veja "falhou" e o motivo — de uma instabilidade de rede, em que
 * marcar falha jogaria fora uma campanha que ia sair no minuto seguinte.
 */
export function destinoDaFalha(permanente: boolean): 'falhar' | 'devolver' {
  return permanente ? 'falhar' : 'devolver';
}

/**
 * A loja tem push configurado?
 *
 * Sem app ou sem chave na OneSignal não há o que tentar, e repetir a cada
 * minuto encheria o log de uma falha que só o lojista resolve.
 */
export function faltaConfiguracao(
  oneSignalAppId: string | null,
  chaveCifrada: string | null,
): string | null {
  if (oneSignalAppId == null || oneSignalAppId === '') {
    return 'Esta loja ainda não tem as notificações configuradas.';
  }
  if (chaveCifrada == null || chaveCifrada === '') {
    return 'Falta a chave de envio desta loja.';
  }
  return null;
}

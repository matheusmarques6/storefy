import 'server-only';

/**
 * Os avisos por e-mail dos chamados (C17 e A14).
 *
 * O chamado não depende do e-mail: ele mora no banco e aparece nas duas telas.
 * O e-mail só avisa que há coisa nova. Sem a Resend ou sem a caixa do suporte
 * configuradas, o aviso não sai — e a conversa continua inteira no painel.
 */
import type { TicketTopic } from '@storefy/db';
import { emailConfigurado, enviarEmail } from '@/lib/email';
import { urlDoSite } from '@/lib/env';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { avisoDeResposta, avisoParaOSuporte } from '@/lib/chamados';
import { log } from '@/lib/log';

/** A caixa da equipe que recebe os chamados, ou `null` sem configuração. */
export function emailDoSuporte(): string | null {
  const valor = (process.env.EMAIL_SUPORTE ?? '').trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valor) ? valor : null;
}

/** Avisa a caixa do suporte de um chamado novo ou de uma resposta do cliente. */
export async function avisarOSuporte(dados: {
  ticketId: string;
  titulo: string;
  empresa: string;
  assunto: TicketTopic;
  trecho: string;
  novo: boolean;
}): Promise<void> {
  const para = emailDoSuporte();
  if (para === null || !emailConfigurado()) return;

  const envio = await enviarEmail({
    para: [para],
    ...avisoParaOSuporte({
      ...dados,
      link: `${urlDoSite()}/admin/chamados/${dados.ticketId}`,
    }),
  });
  if (!envio.ok) log.aviso('chamados.aviso-ao-suporte-nao-saiu', { motivo: envio.motivo });
}

/**
 * Avisa quem abriu o chamado de que a equipe respondeu — se a pessoa ainda
 * está na empresa e não desligou esse aviso (`email_do_autor_do_chamado`).
 */
export async function avisarQuemAbriu(dados: {
  ticketId: string;
  titulo: string;
  resposta: string;
}): Promise<void> {
  if (!emailConfigurado()) return;

  const { data: para, error } = await criarClientServiceRole().rpc('email_do_autor_do_chamado', {
    p_ticket_id: dados.ticketId,
  });
  if (error != null) {
    log.erro('chamados.autor-nao-lido', { falha: error });
    return;
  }
  // Vazio é decisão, e não falha: a pessoa saiu da empresa, não confirmou o
  // e-mail ou desligou o aviso.
  if (typeof para !== 'string' || para === '') return;

  const envio = await enviarEmail({
    para: [para],
    ...avisoDeResposta({
      titulo: dados.titulo,
      resposta: dados.resposta,
      link: `${urlDoSite()}/ajuda/chamados/${dados.ticketId}`,
    }),
  });
  if (!envio.ok) log.aviso('chamados.aviso-de-resposta-nao-saiu', { motivo: envio.motivo });
}

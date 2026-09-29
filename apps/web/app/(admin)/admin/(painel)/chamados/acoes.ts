'use server';

/**
 * A14 — a equipe responde e muda a situação dos chamados.
 *
 * Com o cliente de quem responde: a RLS confere que é da equipe da Storefy
 * (`is_platform_admin`), a mensagem sai com `da_equipe`, e a mudança de
 * situação vai para a trilha da empresa com o autor certo.
 */
import { revalidatePath } from 'next/cache';
import type { TicketStatus } from '@storefy/db';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { respostaSchema } from '@/lib/chamados';
import { avisarQuemAbriu } from '@/lib/chamados-servidor';
import { mensagemDaFalha } from '@/lib/erros';
import {
  extrairErros,
  valoresDigitados,
  type ErrosDeCampo,
  type ValoresDigitados,
} from '@/lib/validacao';

export interface EstadoDaResposta {
  ok?: boolean;
  mensagem?: string;
  erros?: ErrosDeCampo;
  valores?: ValoresDigitados;
}

export async function responderComoEquipe(
  ticketId: string,
  _anterior: EstadoDaResposta,
  dados: FormData,
): Promise<EstadoDaResposta> {
  const usuario = await exigirPlatformAdmin();
  const valores = valoresDigitados(dados, ['mensagem']);
  const analise = respostaSchema.safeParse({ mensagem: dados.get('mensagem') });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };

  const supabase = await criarClientServidor();
  const { data: chamado } = await supabase
    .from('support_tickets')
    .select('id, titulo')
    .eq('id', ticketId)
    .maybeSingle();
  if (chamado == null) return { mensagem: 'Chamado não encontrado.', valores };

  const { error } = await supabase.from('support_messages').insert({
    ticket_id: chamado.id,
    author_id: usuario.id,
    da_equipe: true,
    texto: analise.data.mensagem,
  });
  if (error != null) {
    return {
      mensagem: mensagemDaFalha('chamados', error, 'Não conseguimos enviar. Tente de novo.'),
      valores,
    };
  }

  await avisarQuemAbriu({
    ticketId: chamado.id,
    titulo: chamado.titulo,
    resposta: analise.data.mensagem,
  });

  revalidatePath(`/admin/chamados/${chamado.id}`);
  revalidatePath('/admin/chamados');
  return { ok: true, mensagem: 'Resposta enviada.', valores: {} };
}

const SITUACOES: readonly TicketStatus[] = ['aberto', 'respondido', 'fechado'];

export async function mudarSituacaoDoChamado(
  ticketId: string,
  situacao: string,
): Promise<EstadoDaResposta> {
  await exigirPlatformAdmin();
  const nova = SITUACOES.find((item) => item === situacao);
  if (nova === undefined) return { mensagem: 'Situação desconhecida.' };

  const supabase = await criarClientServidor();
  const { data, error } = await supabase
    .from('support_tickets')
    .update({ status: nova })
    .eq('id', ticketId)
    .neq('status', nova)
    .select('id')
    .maybeSingle();
  if (error != null) {
    return {
      mensagem: mensagemDaFalha('chamados', error, 'Não conseguimos mudar. Tente de novo.'),
    };
  }
  if (data == null) return { mensagem: 'O chamado já estava nessa situação. Atualize a página.' };

  revalidatePath(`/admin/chamados/${ticketId}`);
  revalidatePath('/admin/chamados');
  return { ok: true, mensagem: nova === 'fechado' ? 'Chamado fechado.' : 'Chamado reaberto.' };
}

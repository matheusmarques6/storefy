'use server';

/**
 * C17 — falar com o suporte: abrir chamado, responder e fechar.
 *
 * Tudo com o cliente de quem pede: a RLS garante que o chamado é da empresa
 * dele, que ele escreve como empresa (e não como a equipe) e que só fecha.
 */
import { revalidatePath } from 'next/cache';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { novoChamadoSchema, respostaSchema } from '@/lib/chamados';
import { avisarOSuporte } from '@/lib/chamados-servidor';
import { FALHA_GENERICA, mensagemDaFalha } from '@/lib/erros';
import {
  extrairErros,
  valoresDigitados,
  type ErrosDeCampo,
  type ValoresDigitados,
} from '@/lib/validacao';

export interface EstadoDoChamado {
  ok?: boolean;
  mensagem?: string;
  erros?: ErrosDeCampo;
  valores?: ValoresDigitados;
  /** Para onde ir depois de abrir: a conversa do chamado. */
  destino?: string;
}

/** Chamados por empresa, por hora. Protege a caixa do suporte de um loop. */
const CHAMADOS_POR_HORA = 10;

/** Mensagens por empresa, por hora: cada uma também avisa a caixa do suporte. */
const MENSAGENS_POR_HORA = 30;

export async function abrirChamado(
  _anterior: EstadoDoChamado,
  dados: FormData,
): Promise<EstadoDoChamado> {
  const valores = valoresDigitados(dados, ['assunto', 'titulo', 'mensagem', 'loja']);
  const { organizacao, lojas, visita } = await exigirContextoCliente();
  if (visita != null)
    return { mensagem: 'Durante a visita ao painel de um cliente, nada muda.', valores };

  const analise = novoChamadoSchema.safeParse({
    assunto: dados.get('assunto'),
    titulo: dados.get('titulo'),
    mensagem: dados.get('mensagem'),
    loja: dados.get('loja') ?? undefined,
  });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };

  const { assunto, titulo, mensagem, loja } = analise.data;
  if (loja !== null && !lojas.some((item) => item.id === loja)) {
    return { erros: { loja: 'Escolha uma loja da lista.' }, valores };
  }

  const { data: cabe, error: erroDoLimite } = await criarClientServiceRole().rpc(
    'consumir_limite',
    { p_chave: `chamados:${organizacao.id}`, p_maximo: CHAMADOS_POR_HORA, p_janela_segundos: 3600 },
  );
  if (erroDoLimite != null) {
    return { mensagem: mensagemDaFalha('chamados', erroDoLimite, FALHA_GENERICA), valores };
  }
  if (!cabe) {
    return {
      mensagem:
        'Muitos chamados em pouco tempo. Se for sobre o mesmo assunto, escreva no chamado já aberto.',
      valores,
    };
  }

  const supabase = await criarClientServidor();
  const { data: id, error } = await supabase.rpc('abrir_chamado', {
    p_org_id: organizacao.id,
    p_assunto: assunto,
    p_titulo: titulo,
    p_texto: mensagem,
    ...(loja === null ? {} : { p_store_id: loja }),
  });
  if (error != null) {
    return {
      mensagem: mensagemDaFalha(
        'chamados',
        error,
        'Não conseguimos abrir o chamado. Tente de novo.',
      ),
      valores,
    };
  }

  await avisarOSuporte({
    ticketId: id,
    titulo,
    empresa: organizacao.name,
    assunto,
    trecho: mensagem,
    novo: true,
  });

  revalidatePath('/ajuda');
  return { ok: true, mensagem: 'Chamado aberto.', destino: `/ajuda/chamados/${id}`, valores: {} };
}

export async function responderChamado(
  ticketId: string,
  _anterior: EstadoDoChamado,
  dados: FormData,
): Promise<EstadoDoChamado> {
  const valores = valoresDigitados(dados, ['mensagem']);
  const { organizacao, usuario, visita } = await exigirContextoCliente();
  if (visita != null)
    return { mensagem: 'Durante a visita ao painel de um cliente, nada muda.', valores };

  const analise = respostaSchema.safeParse({ mensagem: dados.get('mensagem') });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };

  const supabase = await criarClientServidor();
  const { data: chamado, error: erroDoChamado } = await supabase
    .from('support_tickets')
    .select('id, titulo, assunto')
    .eq('id', ticketId)
    .eq('org_id', organizacao.id)
    .maybeSingle();
  if (erroDoChamado != null) {
    return { mensagem: mensagemDaFalha('chamados', erroDoChamado, FALHA_GENERICA), valores };
  }
  if (chamado == null) return { mensagem: 'Chamado não encontrado.', valores };

  const { data: cabe, error: erroDoLimite } = await criarClientServiceRole().rpc(
    'consumir_limite',
    {
      p_chave: `mensagens:${organizacao.id}`,
      p_maximo: MENSAGENS_POR_HORA,
      p_janela_segundos: 3600,
    },
  );
  if (erroDoLimite != null) {
    return { mensagem: mensagemDaFalha('chamados', erroDoLimite, FALHA_GENERICA), valores };
  }
  if (!cabe) {
    return {
      mensagem: 'Muitas mensagens em pouco tempo. Espere alguns minutos e envie de novo.',
      valores,
    };
  }

  const { error } = await supabase.from('support_messages').insert({
    ticket_id: chamado.id,
    author_id: usuario.id,
    da_equipe: false,
    texto: analise.data.mensagem,
  });
  if (error != null) {
    return {
      mensagem: mensagemDaFalha('chamados', error, 'Não conseguimos enviar. Tente de novo.'),
      valores,
    };
  }

  await avisarOSuporte({
    ticketId: chamado.id,
    titulo: chamado.titulo,
    empresa: organizacao.name,
    assunto: chamado.assunto,
    trecho: analise.data.mensagem,
    novo: false,
  });

  revalidatePath(`/ajuda/chamados/${chamado.id}`);
  revalidatePath('/ajuda');
  return { ok: true, mensagem: 'Mensagem enviada.', valores: {} };
}

export async function fecharChamado(ticketId: string): Promise<EstadoDoChamado> {
  const { organizacao, visita } = await exigirContextoCliente();
  if (visita != null) return { mensagem: 'Durante a visita ao painel de um cliente, nada muda.' };

  const supabase = await criarClientServidor();
  const { data, error } = await supabase
    .from('support_tickets')
    .update({ status: 'fechado' })
    .eq('id', ticketId)
    .eq('org_id', organizacao.id)
    .neq('status', 'fechado')
    .select('id')
    .maybeSingle();
  if (error != null) {
    return {
      mensagem: mensagemDaFalha('chamados', error, 'Não conseguimos fechar. Tente de novo.'),
    };
  }
  if (data == null) return { mensagem: 'Este chamado já estava fechado.' };

  revalidatePath(`/ajuda/chamados/${ticketId}`);
  revalidatePath('/ajuda');
  return { ok: true, mensagem: 'Chamado fechado. Se precisar, é só escrever de novo nele.' };
}

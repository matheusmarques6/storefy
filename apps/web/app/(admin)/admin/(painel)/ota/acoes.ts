'use server';

/**
 * A correção OTA para todas as lojas (A-OTA, seção 7 do plano).
 *
 * É a ação mais ampla do produto: um clique aqui muda o JavaScript do app de
 * TODOS os clientes na próxima abertura. Por isso ela
 *
 *   exige `platform_admins`, conferido no banco a cada request;
 *   grava em `audit_logs` ANTES de qualquer coisa acontecer, com quem pediu;
 *   recusa quando já existe uma rodada em andamento, porque duas publicando
 *   no mesmo canal deixam o app de uma loja com a versão mais velha.
 */
import { revalidatePath } from 'next/cache';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import {
  MAXIMO_DA_MENSAGEM,
  MOTIVO_DA_RODADA_PARADA,
  mensagemValida,
  paradaDaRodada,
} from '@/lib/ota';
import { dispararOta } from '@/lib/disparo-da-ota';
import { FALHA_GENERICA, mensagemDaFalha } from '@/lib/erros';
import { log } from '@/lib/log';

export interface EstadoDaOta {
  ok?: boolean;
  mensagem?: string;
}

export async function publicarCorrecao(texto: string): Promise<EstadoDaOta> {
  const usuario = await exigirPlatformAdmin();

  if (!mensagemValida(texto)) {
    return {
      mensagem: `Descreva a correção em 5 a ${String(MAXIMO_DA_MENSAGEM)} caracteres. Esse texto é o que alguém vai ler daqui a seis meses.`,
    };
  }

  const servico = criarClientServiceRole();

  /*
   * Uma rodada de cada vez. Duas publicando no mesmo canal em ordem
   * indefinida podem deixar o app de uma loja com a versão MAIS VELHA — e
   * ninguém descobre isso olhando a tela.
   */
  // Com o banco fora, "não sei" não é "nenhuma rodando": duas correções brigariam.
  const { data: emAndamento, error: erroDoAndamento } = await servico
    .from('ota_updates')
    .select('id, status, created_at, updated_at')
    .in('status', ['queued', 'running'])
    .limit(1);

  if (erroDoAndamento != null) {
    return { mensagem: mensagemDaFalha('ota', erroDoAndamento, FALHA_GENERICA) };
  }
  const andamento = emAndamento[0];
  if (andamento !== undefined) {
    // "Aguarde" dito de uma rodada parada há horas seria esperar por nada.
    const parada = paradaDaRodada({
      status: andamento.status,
      criadaEm: andamento.created_at,
      atualizadaEm: andamento.updated_at,
    });
    return {
      mensagem:
        parada === null
          ? 'Já existe uma correção sendo publicada. Aguarde ela terminar.'
          : 'A rodada anterior parou no meio. Encerre-a no histórico, depois de conferir no GitHub, para publicar outra.',
    };
  }

  const { data: rodada, error } = await servico
    .from('ota_updates')
    .insert({ message: texto.trim(), triggered_by: usuario.id })
    .select('id')
    .single();

  if (error != null) {
    return { mensagem: 'Não conseguimos registrar a correção. Tente de novo.' };
  }

  const disparo = await dispararOta(rodada.id, texto);

  if (!disparo.ok) {
    /*
     * O disparo falhou: a rodada vira erro na hora. Deixá-la em "na fila"
     * mostraria uma correção que ninguém vai publicar, e a próxima tentativa
     * esbarraria na trava de "já existe uma em andamento".
     */
    const { error: erroDaMarca } = await servico
      .from('ota_updates')
      .update({
        status: 'errored',
        error: disparo.motivo,
        finished_at: new Date().toISOString(),
      })
      .eq('id', rodada.id);

    revalidatePath('/admin/ota');
    if (erroDaMarca != null) {
      log.erro('admin-ota.erro-nao-marcado', { rodada: rodada.id, falha: erroDaMarca });
      return {
        mensagem: `${disparo.motivo} E a rodada ficou na fila: em meia hora ela aparece como parada no histórico, para ser encerrada.`,
      };
    }
    return { mensagem: disparo.motivo };
  }

  revalidatePath('/admin/ota');
  return { ok: true, mensagem: 'Correção na fila. Acompanhe o andamento aqui.' };
}

/**
 * Encerra uma rodada que parou no meio: "na fila" ou "publicando" sem notícia
 * há tempo demais (`paradaDaRodada`). Sem isto, a rodada aberta trava todas as
 * correções depois dela, e a única saída era mexer no banco.
 *
 * Só encerra se nada mudou desde que foi julgada parada — o mesmo status e a
 * mesma última notícia, conferidos no banco: uma loja contada entre a tela
 * carregar e o clique é sinal de que a rodada anda.
 *
 * A trilha é gravada aqui, com quem encerrou: a trigger de `ota_updates` só
 * audita a criação, como a dos builds — as contas de cada loja encheriam a
 * trilha de linhas sem autor.
 */
export async function encerrarRodadaParada(otaId: string): Promise<EstadoDaOta> {
  const usuario = await exigirPlatformAdmin();
  const servico = criarClientServiceRole({ ator: usuario.id });

  const { data: rodada, error: erroDaLeitura } = await servico
    .from('ota_updates')
    .select('id, status, error, created_at, updated_at')
    .eq('id', otaId)
    .maybeSingle();
  if (erroDaLeitura != null) {
    return { mensagem: mensagemDaFalha('ota', erroDaLeitura, FALHA_GENERICA) };
  }
  if (rodada == null) return { mensagem: 'Rodada não encontrada.' };

  const parada = paradaDaRodada({
    status: rodada.status,
    criadaEm: rodada.created_at,
    atualizadaEm: rodada.updated_at,
  });
  if (parada === null) {
    return {
      mensagem:
        rodada.status === 'queued' || rodada.status === 'running'
          ? 'Esta rodada ainda está dando notícia. Acompanhe no GitHub antes de encerrar.'
          : 'Esta rodada já terminou.',
    };
  }

  const { data: encerrada, error } = await servico
    .from('ota_updates')
    .update({
      status: 'errored',
      error: MOTIVO_DA_RODADA_PARADA,
      finished_at: new Date().toISOString(),
    })
    .eq('id', rodada.id)
    .eq('status', rodada.status)
    .eq('updated_at', rodada.updated_at)
    .select('id')
    .maybeSingle();
  if (error != null) return { mensagem: mensagemDaFalha('ota', error, FALHA_GENERICA) };
  if (encerrada == null) {
    return { mensagem: 'A rodada deu notícia enquanto isso. Atualize a página.' };
  }

  const { error: erroDaTrilha } = await servico.from('audit_logs').insert({
    actor_id: usuario.id,
    // Ação da PLATAFORMA, como a própria correção: não é de nenhum cliente.
    org_id: null,
    action: 'update',
    entity: 'ota_updates',
    entity_id: rodada.id,
    diff: {
      status: { de: rodada.status, para: 'errored' },
      error: { de: rodada.error, para: MOTIVO_DA_RODADA_PARADA },
    },
  });
  // A rodada já foi encerrada; a trilha que faltar precisa chegar à equipe.
  if (erroDaTrilha != null) {
    log.erro('admin-ota.encerrada-sem-auditoria', { rodada: rodada.id, falha: erroDaTrilha });
  }

  revalidatePath('/admin/ota');
  return { ok: true, mensagem: 'Rodada encerrada. Já dá para publicar outra correção.' };
}

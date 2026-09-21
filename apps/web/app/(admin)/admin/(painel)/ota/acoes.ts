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
import { MAXIMO_DA_MENSAGEM, mensagemValida } from '@/lib/ota';
import { dispararOta } from '@/lib/disparo-da-ota';

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
  const { data: emAndamento } = await servico
    .from('ota_updates')
    .select('id')
    .in('status', ['queued', 'running'])
    .limit(1);

  if ((emAndamento ?? []).length > 0) {
    return { mensagem: 'Já existe uma correção sendo publicada. Aguarde ela terminar.' };
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
    await servico
      .from('ota_updates')
      .update({
        status: 'errored',
        error: disparo.motivo,
        finished_at: new Date().toISOString(),
      })
      .eq('id', rodada.id);

    revalidatePath('/admin/ota');
    return { mensagem: disparo.motivo };
  }

  revalidatePath('/admin/ota');
  return { ok: true, mensagem: 'Correção na fila. Acompanhe o andamento aqui.' };
}

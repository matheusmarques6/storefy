'use server';

/**
 * A07 — revalidar a credencial Apple ou Google de um cliente.
 *
 * A conferência é a do envio (`revalidarCredencial`): a chamada mais barata
 * que prova que a chave ainda abre a conta. O que a loja não respondeu não
 * muda nada; a recusa dela deixa a conta "com erro", com o motivo, para o
 * suporte saber o que pedir ao cliente.
 *
 * O segredo é lido pela service role e aberto só no servidor. O RESULTADO é
 * gravado pela sessão da equipe (`admin_gravar_revalidacao`, que confere
 * `platform_admins` com o segundo fator): é o que faz o gatilho de auditoria
 * de `developer_accounts` registrar quem conferiu.
 */
import { revalidatePath } from 'next/cache';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criarClientServidor } from '@/lib/supabase/server';
import { revalidarCredencial } from '@/lib/revalidar-conta';
import { ehUuid } from '@/lib/app-config-publica';
import { log } from '@/lib/log';

export interface EstadoDaRevalidacao {
  ok?: boolean;
  /** A credencial continua valendo? Só quando a loja respondeu. */
  valida?: boolean;
  mensagem?: string;
}

export async function revalidarConta(contaId: string): Promise<EstadoDaRevalidacao> {
  await exigirPlatformAdmin();
  if (!ehUuid(contaId)) return { mensagem: 'Conta não encontrada.' };

  const servico = criarClientServiceRole();
  const { data: conta, error } = await servico
    .from('developer_accounts')
    .select(
      'id, org_id, platform, status, asc_key_id, asc_issuer_id, asc_key_enc, google_service_account_enc',
    )
    .eq('id', contaId)
    .maybeSingle();
  if (error != null) {
    log.erro('admin.revalidar-conta.leitura', { falha: error });
    return { mensagem: 'Não conseguimos ler a conta agora. Tente de novo.' };
  }
  if (conta == null) return { mensagem: 'Conta não encontrada.' };

  const revalidacao = await revalidarCredencial(conta);
  if (revalidacao.resultado === 'sem_credencial') {
    return { mensagem: 'O cliente ainda não enviou as credenciais desta conta.' };
  }
  if (revalidacao.resultado === 'indisponivel') return { mensagem: revalidacao.motivo };

  const valida = revalidacao.resultado === 'valida';
  const sessao = await criarClientServidor();
  const { error: erroDaGravacao } = await sessao.rpc('admin_gravar_revalidacao', {
    p_conta_id: conta.id,
    p_valida: valida,
    p_observacao: (valida ? revalidacao.observacao : revalidacao.motivo) ?? '',
  });
  if (erroDaGravacao != null) {
    log.erro('admin.revalidar-conta.gravacao', { falha: erroDaGravacao });
    return { mensagem: 'A loja respondeu, mas não conseguimos gravar o resultado. Tente de novo.' };
  }

  revalidatePath('/admin/contas');
  revalidatePath(`/admin/organizacoes/${conta.org_id}`);
  const loja = conta.platform === 'apple' ? 'Apple' : 'Google';
  return valida
    ? { ok: true, valida: true, mensagem: `A credencial da ${loja} continua valendo.` }
    : {
        ok: true,
        valida: false,
        mensagem: `A credencial da ${loja} não vale mais: ${revalidacao.motivo}`,
      };
}

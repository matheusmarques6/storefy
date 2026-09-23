'use server';

/**
 * Reexecutar um build a partir do admin (A05).
 *
 * É a ação que o suporte usa quando o build de um cliente quebrou por algo
 * fora da conta dele — uma credencial que expirou no meio, a EAS fora do ar,
 * um erro de rede. Reexecutar é gerar um build NOVO com a mesma config, e não
 * ressuscitar o antigo: o histórico do cliente tem que continuar mostrando que
 * houve uma falha, senão ninguém entende por que a versão pulou um número.
 *
 * A TRAVA QUE IMPORTA: um build por app e plataforma de cada vez. Dois em
 * paralelo disputam o mesmo número de versão na loja, e a Apple recusa o
 * segundo — depois de gerar os dois, cobrando uma hora de build por nada. A
 * tela já esconde o botão nos estados errados; aqui se confere de novo, porque
 * entre a tela carregar e o clique chegar o build pode ter mudado de estado.
 *
 * Quem pediu fica em `builds.triggered_by`, e a trigger de auditoria da tabela
 * grava a linha com o diff. Um build que apareceu do nada na conta de um
 * cliente precisa ter nome.
 */
import { revalidatePath } from 'next/cache';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { podeReexecutar } from '@/lib/builds-admin';
import { dispararBuild, faltaConfiguracaoDoDisparo } from '@/lib/disparo-de-build';

export interface EstadoDoBuild {
  ok?: boolean;
  mensagem?: string;
}

export async function reexecutarBuild(buildId: string): Promise<EstadoDoBuild> {
  const usuario = await exigirPlatformAdmin();
  const servico = criarClientServiceRole();

  const { data: original } = await servico
    .from('builds')
    .select('id, app_id, platform, profile, status, config_version, apps(store_id)')
    .eq('id', buildId)
    .maybeSingle();

  if (original == null) return { mensagem: 'Build não encontrado.' };

  if (!podeReexecutar(original.status)) {
    return {
      mensagem: 'Só dá para reexecutar um build que falhou ou foi cancelado.',
    };
  }

  const storeId = original.apps.store_id;

  /*
   * A conferência de novo, e não por desconfiança da tela: entre ela carregar
   * e o clique chegar, o próprio cliente pode ter disparado uma publicação.
   */
  const { data: emAndamento } = await servico
    .from('builds')
    .select('id')
    .eq('app_id', original.app_id)
    .eq('platform', original.platform)
    .in('status', ['queued', 'building'])
    .limit(1);

  if ((emAndamento ?? []).length > 0) {
    return { mensagem: 'Já existe um build em andamento para esta plataforma. Aguarde.' };
  }

  const falta = faltaConfiguracaoDoDisparo(
    process.env.GITHUB_DISPATCH_TOKEN,
    process.env.GITHUB_REPO,
  );
  if (falta !== null) return { mensagem: falta };

  const { data: novo, error } = await servico
    .from('builds')
    .insert({
      app_id: original.app_id,
      platform: original.platform,
      profile: original.profile,
      status: 'queued',
      config_version: original.config_version,
      triggered_by: usuario.id,
    })
    .select('id')
    .single();

  if (error != null) {
    return { mensagem: 'Não conseguimos registrar o build. Tente de novo.' };
  }

  const disparo = await dispararBuild({
    buildId: novo.id,
    storeId,
    appId: original.app_id,
    platform: original.platform,
    configVersion: original.config_version ?? 0,
  });

  if (!disparo.ok) {
    /*
     * O disparo falhou: o build novo vira erro AGORA. Deixá-lo em "na fila"
     * mostraria ao cliente uma publicação que ninguém vai gerar, e travaria a
     * próxima tentativa na checagem de "já existe um em andamento".
     */
    await servico
      .from('builds')
      .update({
        status: 'errored',
        error: disparo.motivo,
        finished_at: new Date().toISOString(),
      })
      .eq('id', novo.id);

    revalidatePath('/admin/builds');
    return { mensagem: disparo.motivo };
  }

  revalidatePath('/admin/builds');
  return { ok: true, mensagem: 'Build na fila. O cliente vê o andamento na tela de publicação.' };
}

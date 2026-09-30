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
import { FALHA_GENERICA, mensagemDaFalha } from '@/lib/erros';
import { log } from '@/lib/log';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { MOTIVO_DO_PARADO, buildParado, podeReexecutar } from '@/lib/builds-admin';
import { dispararBuild, faltaConfiguracaoDoDisparo } from '@/lib/disparo-de-build';

export interface EstadoDoBuild {
  ok?: boolean;
  mensagem?: string;
}

export async function reexecutarBuild(buildId: string): Promise<EstadoDoBuild> {
  const usuario = await exigirPlatformAdmin();
  const servico = criarClientServiceRole();

  const { data: original, error: erroDoOriginal } = await servico
    .from('builds')
    .select('id, app_id, platform, profile, status, config_version, apps(store_id)')
    .eq('id', buildId)
    .maybeSingle();

  if (erroDoOriginal != null)
    return { mensagem: mensagemDaFalha('build', erroDoOriginal, FALHA_GENERICA) };
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
  /*
   * Com o banco fora, "não sei se há build rodando" não é "não há": seguir
   * dispararia um segundo build disputando o mesmo número de versão.
   */
  const { data: emAndamento, error: erroDoAndamento } = await servico
    .from('builds')
    .select('id')
    .eq('app_id', original.app_id)
    .eq('platform', original.platform)
    .in('status', ['queued', 'building'])
    .limit(1);

  if (erroDoAndamento != null)
    return { mensagem: mensagemDaFalha('build', erroDoAndamento, FALHA_GENERICA) };
  if (emAndamento.length > 0) {
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
    // Cliente com a assinatura fora de dia: o banco recusa e diz por quê — a
    // saída é estender o teste na ficha dele (A04), e a frase aponta o caminho.
    return {
      mensagem: mensagemDaFalha(
        'builds',
        error,
        'Não conseguimos registrar o build. Tente de novo.',
      ),
    };
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
    const { error: erroDaMarca } = await servico
      .from('builds')
      .update({
        status: 'errored',
        error: disparo.motivo,
        finished_at: new Date().toISOString(),
      })
      .eq('id', novo.id);

    revalidatePath('/admin/builds');
    if (erroDaMarca != null) {
      // Sem a marca, o build fica "na fila" e trava a próxima publicação da loja.
      log.erro('admin-build.erro-nao-marcado', { build: novo.id, falha: erroDaMarca });
      return {
        mensagem: `${disparo.motivo} E o build ficou na fila: marque-o como parado nesta tela antes de tentar de novo.`,
      };
    }
    return { mensagem: disparo.motivo };
  }

  revalidatePath('/admin/builds');
  return { ok: true, mensagem: 'Build na fila. O cliente vê o andamento na tela de publicação.' };
}

/**
 * Encerra um build que parou no meio (A05): "na fila" ou "gerando" há tempo
 * demais. Sem isto, a loja não publica mais — a publicação recusa enquanto há
 * um em andamento, e o reexecutar só aceita o que falhou.
 *
 * O build vira `errored` com um motivo que o lojista entende, e só se ainda
 * estiver no MESMO estado em que foi julgado parado, conferido no banco: entre
 * a tela carregar e o clique, o webhook da EAS pode ter chegado, ou o workflow
 * pode ter tirado o build da fila.
 *
 * A trilha é gravada aqui, com quem encerrou e a organização da loja: a
 * trigger de `builds` só audita a criação, de propósito (os status que o
 * webhook escreve encheriam a trilha de linhas sem autor).
 */
export async function marcarBuildParado(buildId: string): Promise<EstadoDoBuild> {
  const usuario = await exigirPlatformAdmin();
  const servico = criarClientServiceRole({ ator: usuario.id });

  const { data: build, error: erroDaLeitura } = await servico
    .from('builds')
    .select('id, status, error, created_at, started_at, apps!inner(stores!inner(org_id))')
    .eq('id', buildId)
    .maybeSingle();
  if (erroDaLeitura != null) {
    return { mensagem: mensagemDaFalha('build', erroDaLeitura, FALHA_GENERICA) };
  }
  if (build == null) return { mensagem: 'Build não encontrado.' };

  const emAndamento = {
    status: build.status,
    criadoEm: build.created_at,
    iniciadoEm: build.started_at,
  };
  if (!buildParado(emAndamento)) {
    return {
      mensagem:
        build.status === 'queued' || build.status === 'building'
          ? 'Este build ainda está dentro do tempo normal. Veja os logs antes de encerrar.'
          : 'Este build já terminou.',
    };
  }

  const { data: encerrado, error } = await servico
    .from('builds')
    .update({ status: 'errored', error: MOTIVO_DO_PARADO, finished_at: new Date().toISOString() })
    .eq('id', build.id)
    .eq('status', build.status)
    .select('id')
    .maybeSingle();
  if (error != null) return { mensagem: mensagemDaFalha('build', error, FALHA_GENERICA) };
  if (encerrado == null) {
    return { mensagem: 'O build mudou de estado enquanto isso. Atualize a página.' };
  }

  const { error: erroDaTrilha } = await servico.from('audit_logs').insert({
    actor_id: usuario.id,
    org_id: build.apps.stores.org_id,
    action: 'update',
    entity: 'builds',
    entity_id: build.id,
    diff: {
      status: { de: build.status, para: 'errored' },
      error: { de: build.error, para: MOTIVO_DO_PARADO },
    },
  });
  // O build já foi encerrado; a trilha que faltar precisa chegar à equipe.
  if (erroDaTrilha != null) {
    log.erro('admin-build.encerrado-sem-auditoria', { build: build.id, falha: erroDaTrilha });
  }

  revalidatePath('/admin/builds');
  return {
    ok: true,
    mensagem:
      'Build encerrado. A loja já pode publicar de novo, e o motivo aparece para o lojista.',
  };
}

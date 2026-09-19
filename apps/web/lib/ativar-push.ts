import 'server-only';

/**
 * Ligar as notificações de uma loja (seção 6 do plano).
 *
 * Junta o que já existe: as credenciais que a organização enviou
 * (`developer_accounts`), o identificador do app (`apps.bundle_id_ios`) e a
 * Organization API Key da Storefy. Com as três, cria o app da loja na
 * OneSignal e guarda a chave REST criptografada.
 *
 * Toda a leitura de segredo acontece com a service role, no servidor, e o
 * valor em claro existe só dentro desta função — o painel nunca vê nenhum dos
 * dois lados.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { criptografar, descriptografar } from '@/lib/cripto';
import { criarAppDaLoja, diagnosticar, type Pendencia } from '@/lib/onesignal-org';

type Client = SupabaseClient<Database>;

export interface EstadoDasNotificacoes {
  /** Já está ligado? */
  ligado: boolean;
  /** O que falta, quando não está. */
  pendencias: Pendencia[];
}

/**
 * O que falta para esta loja enviar notificação.
 *
 * Lido com a service role porque precisa saber se os segredos EXISTEM — e as
 * colunas `_enc` são invisíveis para o painel de propósito. O que volta daqui
 * é só booleano e texto; nenhum segredo atravessa.
 */
export async function estadoDasNotificacoes(
  servico: Client,
  storeId: string,
): Promise<EstadoDasNotificacoes> {
  const { data: app } = await servico
    .from('apps')
    .select('id, onesignal_app_id, bundle_id_ios, store_id')
    .eq('store_id', storeId)
    .maybeSingle();

  if (app == null) {
    return {
      ligado: false,
      pendencias: [{ texto: 'Não encontramos o app desta loja.', de: 'storefy' }],
    };
  }
  if (app.onesignal_app_id !== null && app.onesignal_app_id !== '') {
    return { ligado: true, pendencias: [] };
  }

  const { data: loja } = await servico
    .from('stores')
    .select('org_id')
    .eq('id', storeId)
    .maybeSingle();

  const { data: contas } = await servico
    .from('developer_accounts')
    .select('platform, status, apns_key_enc, google_service_account_enc')
    .eq('org_id', loja?.org_id ?? '');

  const apple = (contas ?? []).find((conta) => conta.platform === 'apple');
  const google = (contas ?? []).find((conta) => conta.platform === 'google');

  return {
    ligado: false,
    pendencias: diagnosticar({
      orgApiKey: process.env.ONESIGNAL_ORG_API_KEY,
      // "Verificada" é status E credencial presente: um status verificado sem
      // a chave gravada faria a tela dizer "tudo pronto" e o botão falhar.
      appleVerificada:
        apple?.status === 'verified' && apple.apns_key_enc !== null && apple.apns_key_enc !== '',
      googleVerificada:
        google?.status === 'verified' &&
        google.google_service_account_enc !== null &&
        google.google_service_account_enc !== '',
      bundleId: app.bundle_id_ios,
    }),
  };
}

export type ResultadoDaAtivacao =
  { ok: true; oneSignalAppId: string } | { ok: false; motivo: string };

/**
 * Cria o app da loja na OneSignal e guarda as chaves.
 *
 * A criação NÃO é idempotente do lado da OneSignal: chamar duas vezes cria
 * dois apps, e o segundo fica com os mesmos certificados e nenhum aparelho.
 * Por isso `onesignal_app_id` é relido aqui, e não aceito da tela — entre o
 * carregamento da página e o clique, outra pessoa da mesma organização pode
 * ter clicado antes.
 */
export async function ativarNotificacoes(
  servico: Client,
  storeId: string,
): Promise<ResultadoDaAtivacao> {
  const { data: app } = await servico
    .from('apps')
    .select('id, onesignal_app_id, bundle_id_ios, display_name, store_id')
    .eq('store_id', storeId)
    .maybeSingle();

  if (app == null) return { ok: false, motivo: 'Não encontramos o app desta loja.' };
  if (app.onesignal_app_id !== null && app.onesignal_app_id !== '') {
    return { ok: true, oneSignalAppId: app.onesignal_app_id };
  }

  const orgApiKey = process.env.ONESIGNAL_ORG_API_KEY;
  if (orgApiKey == null || orgApiKey === '') {
    return {
      ok: false,
      motivo: 'A Storefy ainda não terminou de configurar o serviço de notificações.',
    };
  }
  if (app.bundle_id_ios === null || app.bundle_id_ios === '') {
    return {
      ok: false,
      motivo: 'O app desta loja ainda não tem um identificador. Ele é definido na publicação.',
    };
  }

  const { data: loja } = await servico
    .from('stores')
    .select('org_id, name')
    .eq('id', storeId)
    .maybeSingle();
  if (loja == null) return { ok: false, motivo: 'Loja não encontrada.' };

  const { data: contas } = await servico
    .from('developer_accounts')
    .select(
      'platform, status, apple_team_id, apns_key_id, apns_key_enc, google_service_account_enc',
    )
    .eq('org_id', loja.org_id);

  const apple = (contas ?? []).find((conta) => conta.platform === 'apple');
  const google = (contas ?? []).find((conta) => conta.platform === 'google');

  if (apple?.apns_key_enc == null || apple.apns_key_id == null || apple.apple_team_id == null) {
    return {
      ok: false,
      motivo: 'Falta conectar a conta Apple da sua empresa e enviar a chave de notificações.',
    };
  }
  if (google?.google_service_account_enc == null) {
    return {
      ok: false,
      motivo: 'Falta conectar a conta Google da sua empresa e enviar o arquivo de serviço.',
    };
  }

  let apnsP8: string;
  let fcmJson: string;
  try {
    apnsP8 = descriptografar(apple.apns_key_enc);
    fcmJson = descriptografar(google.google_service_account_enc);
  } catch {
    return {
      ok: false,
      motivo: 'Não conseguimos ler as credenciais gravadas. Envie os arquivos de novo.',
    };
  }

  const resultado = await criarAppDaLoja(orgApiKey, {
    nome: app.display_name === '' ? loja.name : app.display_name,
    bundleId: app.bundle_id_ios,
    apnsP8,
    apnsKeyId: apple.apns_key_id,
    appleTeamId: apple.apple_team_id,
    fcmServiceAccountJson: fcmJson,
  });

  if (!resultado.ok) return { ok: false, motivo: resultado.motivo };

  /*
   * A chave REST só aparece na resposta da criação. Se a gravação falhar
   * agora, existe um app na OneSignal que a Storefy não consegue usar — por
   * isso o erro é explícito e cita o suporte, em vez de um "tente de novo" que
   * criaria um segundo app.
   */
  const { error } = await servico
    .from('apps')
    .update({
      onesignal_app_id: resultado.app.appId,
      onesignal_api_key_enc: criptografar(resultado.app.chaveRest),
    })
    .eq('id', app.id);

  if (error != null) {
    return {
      ok: false,
      motivo:
        'As notificações foram criadas, mas não conseguimos guardar a chave. Fale com o suporte antes de tentar de novo.',
    };
  }

  return { ok: true, oneSignalAppId: resultado.app.appId };
}

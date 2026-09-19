import 'server-only';

/**
 * O que a tela de publicação (C12) precisa saber sobre uma loja.
 *
 * Junta coisas de quatro tabelas, e a razão de estar num lugar só é que o
 * checklist tem de ver o mesmo estado que o botão de publicar. Duas leituras
 * separadas divergiriam, e a divergência apareceria como um botão habilitado
 * que falha.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import type { EstadoDaPublicacao } from '@/lib/checklist-de-publicacao';

type Client = SupabaseClient<Database>;

export interface BuildNaLista {
  id: string;
  platform: 'ios' | 'android';
  status: Database['public']['Enums']['build_status'];
  version: string | null;
  buildNumber: number | null;
  error: string | null;
  logsUrl: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface DadosDaPublicacao {
  appId: string;
  estado: EstadoDaPublicacao;
  builds: BuildNaLista[];
}

/**
 * Ainda há build acontecendo?
 *
 * Decide se a tela precisa ficar se atualizando sozinha. Só `queued` e
 * `building` contam: os outros status são desfecho, e um build que terminou não
 * muda mais por conta própria — quem o mover dali é a Apple ou o Google, pelo
 * cron da revisão, que é outra história e outra cadência.
 */
export function temBuildEmAndamento(builds: readonly BuildNaLista[]): boolean {
  return builds.some((build) => build.status === 'queued' || build.status === 'building');
}

export async function dadosDaPublicacao(
  supabase: Client,
  storeId: string,
  orgId: string,
): Promise<DadosDaPublicacao | null> {
  const { data: app } = await supabase
    .from('apps')
    .select(
      'id, display_name, icon_path, splash_path, bundle_id_ios, package_android, onesignal_app_id, current_config_version',
    )
    .eq('store_id', storeId)
    .maybeSingle();

  if (app == null) return null;

  const [{ data: publicada }, { data: contas }, { data: builds }] = await Promise.all([
    supabase
      .from('app_configs')
      .select('version')
      .eq('app_id', app.id)
      .eq('status', 'published')
      .maybeSingle(),
    supabase.from('developer_accounts').select('platform, status').eq('org_id', orgId),
    supabase
      .from('builds')
      .select(
        'id, platform, status, version, build_number, error, logs_url, created_at, finished_at',
      )
      .eq('app_id', app.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const verificada = (plataforma: 'apple' | 'google'): boolean =>
    (contas ?? []).some((conta) => conta.platform === plataforma && conta.status === 'verified');

  return {
    appId: app.id,
    estado: {
      nomeDoApp: app.display_name,
      versaoPublicada: publicada?.version ?? null,
      iconePronto: app.icon_path !== null && app.icon_path !== '',
      splashPronta: app.splash_path !== null && app.splash_path !== '',
      bundleIdIos: app.bundle_id_ios,
      packageAndroid: app.package_android,
      appleConectada: verificada('apple'),
      googleConectada: verificada('google'),
      pushLigado: app.onesignal_app_id !== null && app.onesignal_app_id !== '',
    },
    builds: (builds ?? []).map((linha) => ({
      id: linha.id,
      platform: linha.platform,
      status: linha.status,
      version: linha.version,
      buildNumber: linha.build_number,
      error: linha.error,
      logsUrl: linha.logs_url,
      createdAt: linha.created_at,
      finishedAt: linha.finished_at,
    })),
  };
}

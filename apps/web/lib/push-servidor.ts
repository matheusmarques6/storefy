import 'server-only';

/**
 * Leitura de campanhas e automações pelo painel.
 *
 * Tudo passa pelo client da sessão, então quem decide o que aparece é a RLS —
 * estas funções não ganham privilégio nenhum. A service role fica para os
 * jobs e para os endpoints públicos, que não têm usuário do outro lado.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import type { TipoDeAutomacao } from '@/lib/automacao';
import type { StatusDaCampanha } from '@/lib/campanha';

type Client = SupabaseClient<Database>;

export interface CampanhaNaLista {
  id: string;
  title: string;
  body: string;
  deepLink: string | null;
  status: StatusDaCampanha;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  stats: unknown;
}

export interface AutomacaoSalva {
  id: string;
  type: TipoDeAutomacao;
  enabled: boolean;
  delayMinutes: number;
  title: string;
  body: string;
  deepLink: string | null;
}

/**
 * O app da loja ativa, com o que o push precisa saber sobre ele.
 *
 * `onesignal_api_key_enc` não vem — é coluna de segredo, e a RLS de coluna já
 * barraria a leitura. O que interessa ao painel é se ela EXISTE, e isso o
 * `onesignal_app_id` já responde na prática: os dois são gravados juntos.
 */
export interface AppDaLoja {
  id: string;
  oneSignalAppId: string | null;
}

export async function appDaLoja(supabase: Client, storeId: string): Promise<AppDaLoja | null> {
  const { data } = await supabase
    .from('apps')
    .select('id, onesignal_app_id')
    .eq('store_id', storeId)
    .maybeSingle();

  return data == null ? null : { id: data.id, oneSignalAppId: data.onesignal_app_id };
}

export async function listarCampanhas(
  supabase: Client,
  appId: string,
  limite = 50,
): Promise<CampanhaNaLista[]> {
  const { data } = await supabase
    .from('push_campaigns')
    .select('id, title, body, deep_link, status, scheduled_at, sent_at, created_at, stats')
    .eq('app_id', appId)
    .order('created_at', { ascending: false })
    .limit(limite);

  return (data ?? []).map((linha) => ({
    id: linha.id,
    title: linha.title,
    body: linha.body,
    deepLink: linha.deep_link,
    status: linha.status,
    scheduledAt: linha.scheduled_at,
    sentAt: linha.sent_at,
    createdAt: linha.created_at,
    stats: linha.stats,
  }));
}

export async function buscarCampanha(
  supabase: Client,
  appId: string,
  campanhaId: string,
): Promise<CampanhaNaLista | null> {
  const { data } = await supabase
    .from('push_campaigns')
    .select('id, title, body, deep_link, status, scheduled_at, sent_at, created_at, stats')
    .eq('app_id', appId)
    .eq('id', campanhaId)
    .maybeSingle();

  if (data == null) return null;
  return {
    id: data.id,
    title: data.title,
    body: data.body,
    deepLink: data.deep_link,
    status: data.status,
    scheduledAt: data.scheduled_at,
    sentAt: data.sent_at,
    createdAt: data.created_at,
    stats: data.stats,
  };
}

export async function listarAutomacoes(supabase: Client, appId: string): Promise<AutomacaoSalva[]> {
  const { data } = await supabase
    .from('push_automations')
    .select('id, type, enabled, delay_minutes, title, body, deep_link')
    .eq('app_id', appId);

  return (data ?? [])
    .filter(
      (linha): linha is typeof linha & { type: TipoDeAutomacao } =>
        linha.type === 'welcome' || linha.type === 'abandoned_cart',
    )
    .map((linha) => ({
      id: linha.id,
      type: linha.type,
      enabled: linha.enabled,
      delayMinutes: linha.delay_minutes,
      title: linha.title,
      body: linha.body,
      deepLink: linha.deep_link,
    }));
}

export interface AparelhoParaTeste {
  id: string;
  subscriptionId: string;
  platform: 'ios' | 'android';
  appVersion: string | null;
  lastSeenAt: string;
}

/**
 * Os aparelhos vistos mais recentemente, para o envio de teste.
 *
 * O lojista instala o próprio app, abre, e ele aparece no topo da lista. É
 * assim que ele manda a notificação para o PRÓPRIO celular antes de mandar
 * para dez mil pessoas — e é a última chance de ver o texto cortado, o link
 * errado ou o emoji que não renderiza.
 *
 * Poucos de propósito: a lista existe para o lojista se achar nela, não para
 * navegar pela base de clientes.
 */
export async function aparelhosRecentes(
  supabase: Client,
  appId: string,
  limite = 10,
): Promise<AparelhoParaTeste[]> {
  const { data } = await supabase
    .from('devices')
    .select('id, onesignal_subscription_id, platform, app_version, last_seen_at')
    .eq('app_id', appId)
    .order('last_seen_at', { ascending: false })
    .limit(limite);

  return (data ?? []).map((linha) => ({
    id: linha.id,
    subscriptionId: linha.onesignal_subscription_id,
    platform: linha.platform,
    appVersion: linha.app_version,
    lastSeenAt: linha.last_seen_at,
  }));
}

/**
 * Quantos aparelhos deste app podem receber push.
 *
 * É o número que diz ao lojista se vale a pena mandar campanha. Vem do nosso
 * banco, e não da OneSignal, para ser o mesmo número em todo lugar do painel.
 */
export async function contarAparelhos(supabase: Client, appId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from('devices')
    .select('id', { count: 'exact', head: true })
    .eq('app_id', appId);

  // `null` quer dizer "não conseguimos contar", e a tela mostra um traço.
  // Zero é uma afirmação — "ninguém instalou" — e só se diz quando é verdade.
  return error != null ? null : (count ?? null);
}

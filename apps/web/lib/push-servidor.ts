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
import { ehTipoDeAutomacao, type TipoDeAutomacao } from '@/lib/automacao';
import type { StatusDaCampanha } from '@/lib/campanha';
import { urlDaImagemDoPush } from '@/lib/imagem-do-push';
import { publicoDoSegmento, type Publico } from '@/lib/publico-do-push';
import type { Vendas } from '@/lib/vendas-do-push';

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
  /** A imagem da campanha: o caminho no bucket e o endereço público. */
  imagem: { caminho: string; url: string } | null;
  /** Quem recebe. */
  publico: Publico;
}

const COLUNAS_DA_CAMPANHA =
  'id, title, body, deep_link, status, scheduled_at, sent_at, created_at, stats, image_path, segment' as const;

type LinhaDaCampanha = Pick<
  Database['public']['Tables']['push_campaigns']['Row'],
  | 'id'
  | 'title'
  | 'body'
  | 'deep_link'
  | 'status'
  | 'scheduled_at'
  | 'sent_at'
  | 'created_at'
  | 'stats'
  | 'image_path'
  | 'segment'
>;

function campanhaDaLinha(supabase: Client, linha: LinhaDaCampanha): CampanhaNaLista {
  return {
    id: linha.id,
    title: linha.title,
    body: linha.body,
    deepLink: linha.deep_link,
    status: linha.status,
    scheduledAt: linha.scheduled_at,
    sentAt: linha.sent_at,
    createdAt: linha.created_at,
    stats: linha.stats,
    imagem:
      linha.image_path === null
        ? null
        : { caminho: linha.image_path, url: urlDaImagemDoPush(supabase, linha.image_path) },
    publico: publicoDoSegmento(linha.segment),
  };
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

/**
 * Erro de leitura vira a tela de erro do painel (com "tentar de novo"), e não
 * lista vazia: "nenhuma campanha" com o banco fora do ar seria mentira — e o
 * lojista criaria de novo a campanha que já existe.
 */
function falhouAoLer(oQue: string, erro: { message: string } | null): void {
  if (erro != null) throw new Error(`Não foi possível ler ${oQue}: ${erro.message}`);
}

export async function appDaLoja(supabase: Client, storeId: string): Promise<AppDaLoja | null> {
  const { data, error } = await supabase
    .from('apps')
    .select('id, onesignal_app_id')
    .eq('store_id', storeId)
    .maybeSingle();
  falhouAoLer('o app da loja', error);

  return data == null ? null : { id: data.id, oneSignalAppId: data.onesignal_app_id };
}

export async function listarCampanhas(
  supabase: Client,
  appId: string,
  limite = 50,
): Promise<CampanhaNaLista[]> {
  const { data, error } = await supabase
    .from('push_campaigns')
    .select(COLUNAS_DA_CAMPANHA)
    .eq('app_id', appId)
    .order('created_at', { ascending: false })
    .limit(limite);
  falhouAoLer('as campanhas', error);

  return (data ?? []).map((linha) => campanhaDaLinha(supabase, linha));
}

export async function buscarCampanha(
  supabase: Client,
  appId: string,
  campanhaId: string,
): Promise<CampanhaNaLista | null> {
  const { data, error } = await supabase
    .from('push_campaigns')
    .select(COLUNAS_DA_CAMPANHA)
    .eq('app_id', appId)
    .eq('id', campanhaId)
    .maybeSingle();
  falhouAoLer('a campanha', error);

  return data == null ? null : campanhaDaLinha(supabase, data);
}

export async function listarAutomacoes(supabase: Client, appId: string): Promise<AutomacaoSalva[]> {
  const { data, error } = await supabase
    .from('push_automations')
    .select('id, type, enabled, delay_minutes, title, body, deep_link')
    .eq('app_id', appId);
  falhouAoLer('as automações', error);

  /*
   * Pelo MESMO critério da tela (`ehTipoDeAutomacao`). Um filtro escrito à
   * mão com os dois tipos da Fase 3 deixava "Pedido enviado", "De volta ao
   * estoque" e "Sentimos sua falta" sempre desligados na tela, mesmo ligados.
   */
  return (data ?? [])
    .filter((linha): linha is typeof linha & { type: TipoDeAutomacao } =>
      ehTipoDeAutomacao(linha.type),
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

/**
 * O que as notificações venderam: os pedidos feitos até três dias depois de o
 * cliente tocar numa delas, e a receita desses pedidos (C07, C09 e C10). O
 * formato mora em `vendas-do-push`, que a tela do navegador também importa.
 *
 * A soma é do banco, pela RLS de `shop_orders`: o lojista só soma pedido das
 * próprias lojas, e um id de campanha de outra loja volta sem nada.
 */
export type VendasDoPush = Vendas;

/** Uma automação na janela: quantas notificações saíram e o que venderam. */
export interface ResultadoDaAutomacao extends Vendas {
  envios: number;
}

const SEM_VENDAS: VendasDoPush = { pedidos: 0, receitaCents: 0 };

/**
 * As vendas de cada campanha pedida.
 *
 * A campanha que não vendeu não volta do banco, e aqui ela vira zero de
 * propósito: para uma campanha enviada numa loja com a Shopify conectada,
 * "nenhum pedido" é a resposta verdadeira. Quem decide se a tela pode afirmar
 * isso — a loja pode nem ter a Shopify ligada — é a tela.
 */
export async function vendasDasCampanhas(
  supabase: Client,
  ids: readonly string[],
): Promise<Map<string, VendasDoPush>> {
  const vendas = new Map<string, VendasDoPush>(ids.map((id) => [id, SEM_VENDAS]));
  if (ids.length === 0) return vendas;

  const { data, error } = await supabase.rpc('receita_das_campanhas', { p_ids: [...ids] });
  falhouAoLer('as vendas das campanhas', error);

  for (const linha of data ?? []) {
    if (linha.campanha_id === null) continue;
    vendas.set(linha.campanha_id, {
      pedidos: linha.pedidos ?? 0,
      receitaCents: linha.receita_cents ?? 0,
    });
  }
  return vendas;
}

/** Envios, pedidos e receita de cada automação do app nos últimos `dias`. */
export async function resultadoDasAutomacoes(
  supabase: Client,
  appId: string,
  dias = 30,
): Promise<Map<string, ResultadoDaAutomacao>> {
  const { data, error } = await supabase.rpc('resultado_das_automacoes', {
    p_app_id: appId,
    p_dias: dias,
  });
  falhouAoLer('o resultado das automações', error);

  const resultado = new Map<string, ResultadoDaAutomacao>();
  for (const linha of data ?? []) {
    if (linha.automacao_id === null) continue;
    resultado.set(linha.automacao_id, {
      envios: linha.envios ?? 0,
      pedidos: linha.pedidos ?? 0,
      receitaCents: linha.receita_cents ?? 0,
    });
  }
  return resultado;
}

/** O total das notificações do app nos últimos `dias`, campanhas e automações. */
export async function vendasDoPush(
  supabase: Client,
  appId: string,
  dias = 30,
): Promise<VendasDoPush> {
  const { data, error } = await supabase.rpc('receita_do_push', { p_app_id: appId, p_dias: dias });
  falhouAoLer('as vendas das notificações', error);

  const [linha] = data ?? [];
  return linha === undefined
    ? SEM_VENDAS
    : { pedidos: linha.pedidos ?? 0, receitaCents: linha.receita_cents ?? 0 };
}

/** A chave do webhook de automação, como a tela pode mostrar (nunca o hash). */
export interface ChaveDoWebhook {
  dica: string;
  criadaEm: string;
  ultimoAviso: string | null;
  avisos: number;
}

export async function chaveDoWebhook(
  supabase: Client,
  appId: string,
): Promise<ChaveDoWebhook | null> {
  const { data, error } = await supabase
    .from('automation_webhooks')
    .select('token_hint, created_at, last_received_at, received_count')
    .eq('app_id', appId)
    .maybeSingle();
  falhouAoLer('a chave do webhook', error);

  return data == null
    ? null
    : {
        dica: data.token_hint,
        criadaEm: data.created_at,
        ultimoAviso: data.last_received_at,
        avisos: data.received_count,
      };
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
  const { data, error } = await supabase
    .from('devices')
    .select('id, onesignal_subscription_id, platform, app_version, last_seen_at')
    .eq('app_id', appId)
    // Sem inscrição (app sem push, ou antes de o SDK criá-la), não há para onde mandar.
    .not('onesignal_subscription_id', 'is', null)
    .order('last_seen_at', { ascending: false })
    .limit(limite);
  falhouAoLer('os aparelhos', error);

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
    .eq('app_id', appId)
    // O aparelho sem inscrição conta nas instalações, mas não recebe push.
    .not('onesignal_subscription_id', 'is', null);

  // `null` quer dizer "não conseguimos contar", e a tela mostra um traço.
  // Zero é uma afirmação — "ninguém instalou" — e só se diz quando é verdade.
  return error != null ? null : (count ?? null);
}

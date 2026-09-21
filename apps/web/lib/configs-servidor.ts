import 'server-only';

/**
 * Leitura e escrita de `app_configs` pelo servidor.
 *
 * Tudo aqui passa pelo client da sessão do usuário, então é a RLS que decide o
 * que pode — as funções não ganham privilégio nenhum. A decisão de QUAL
 * rascunho abrir está em `lib/rascunho.ts`, que é pura e testada.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import type { AppConfig } from '@storefy/config-schema';
import { decidirRascunho } from '@/lib/rascunho';

type Client = SupabaseClient<Database>;

export interface RascunhoDoApp {
  appId: string;
  version: number;
  config: AppConfig;
}

export type ResultadoDoRascunho =
  { ok: true; rascunho: RascunhoDoApp } | { ok: false; motivo: string };

/** Versão publicada no ar, se houver. */
export interface VersaoPublicada {
  version: number;
  publishedAt: string | null;
}

/** Uma linha do histórico, para a tela de versões. */
export interface VersaoDoHistorico {
  version: number;
  status: Database['public']['Enums']['app_config_status'];
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
}

/**
 * Devolve o rascunho do app desta loja, criando ou consertando se precisar.
 *
 * É chamada tanto ao criar a loja quanto ao abrir o editor. Chamar duas vezes
 * não duplica nada: quando já existe rascunho válido, só lê.
 */
export async function garantirRascunho(
  supabase: Client,
  storeId: string,
): Promise<ResultadoDoRascunho> {
  const { data: loja, error: erroLoja } = await supabase
    .from('stores')
    .select('name, primary_url, shop_domain, platform')
    .eq('id', storeId)
    .maybeSingle();

  if (erroLoja != null) return { ok: false, motivo: erroLoja.message };
  if (loja == null) return { ok: false, motivo: 'Loja não encontrada.' };

  const { data: app, error: erroApp } = await supabase
    .from('apps')
    .select('id')
    .eq('store_id', storeId)
    .maybeSingle();

  if (erroApp != null) return { ok: false, motivo: erroApp.message };
  if (app == null) {
    // O trigger `on_store_created` cria o app junto com a loja; chegar aqui
    // sem ele significa que a loja foi criada por fora do fluxo normal.
    return { ok: false, motivo: 'Este app ainda não foi criado para a loja.' };
  }

  const [{ data: maior }, { data: rascunho }] = await Promise.all([
    supabase
      .from('app_configs')
      .select('version')
      .eq('app_id', app.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('app_configs')
      .select('version, config')
      .eq('app_id', app.id)
      .eq('status', 'draft')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const decisao = decidirRascunho(
    loja,
    rascunho == null ? null : { version: rascunho.version, config: rascunho.config },
    maior?.version ?? 0,
  );

  if (decisao.acao === 'criar') {
    const { error } = await supabase.from('app_configs').insert({
      app_id: app.id,
      version: decisao.version,
      config: decisao.config,
      status: 'draft',
    });
    if (error != null) return { ok: false, motivo: error.message };
  }

  if (decisao.acao === 'consertar') {
    const { error } = await supabase
      .from('app_configs')
      .update({ config: decisao.config })
      .eq('app_id', app.id)
      .eq('version', decisao.version);
    if (error != null) return { ok: false, motivo: error.message };
  }

  return {
    ok: true,
    rascunho: { appId: app.id, version: decisao.version, config: decisao.config },
  };
}

/** Grava o rascunho editado. A versão não muda; publicar é que cria a próxima. */
export async function salvarRascunho(
  supabase: Client,
  appId: string,
  version: number,
  config: AppConfig,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const { data, error } = await supabase
    .from('app_configs')
    .update({ config })
    .eq('app_id', appId)
    .eq('version', version)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle();

  if (error != null) return { ok: false, motivo: error.message };
  // Sem erro e sem linha: a RLS filtrou o UPDATE, ou o rascunho já foi
  // publicado por outra aba enquanto esta estava aberta.
  if (data == null) {
    return {
      ok: false,
      motivo:
        'Não foi possível salvar. Confira se você ainda tem permissão e se esta versão continua sendo o rascunho.',
    };
  }
  return { ok: true };
}

/** A versão que está no ar, para a tela do editor mostrar. */
export async function versaoPublicada(
  supabase: Client,
  appId: string,
): Promise<VersaoPublicada | null> {
  const { data } = await supabase
    .from('app_configs')
    .select('version, published_at')
    .eq('app_id', appId)
    .eq('status', 'published')
    .maybeSingle();

  return data == null ? null : { version: data.version, publishedAt: data.published_at };
}

/** Histórico completo, da versão mais nova para a mais antiga. */
export async function historicoDeVersoes(
  supabase: Client,
  appId: string,
  limite = 50,
): Promise<VersaoDoHistorico[]> {
  const { data } = await supabase
    .from('app_configs')
    .select('version, status, published_at, published_by, created_at')
    .eq('app_id', appId)
    .order('version', { ascending: false })
    .limit(limite);

  return (data ?? []).map((linha) => ({
    version: linha.version,
    status: linha.status,
    publishedAt: linha.published_at,
    publishedBy: linha.published_by,
    createdAt: linha.created_at,
  }));
}

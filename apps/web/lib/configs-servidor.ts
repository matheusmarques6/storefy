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
import { safeParseAppConfig, type AppConfig } from '@storefy/config-schema';
import { decidirRascunho } from '@/lib/rascunho';
import { FALHA_GENERICA, mensagemDaFalha } from '@/lib/erros';

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
  /**
   * A config no ar, para o editor contar o que mudou desde ela. Nula quando a
   * gravada não passa mais pelo contrato — aí não há com o que comparar.
   */
  config: AppConfig | null;
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

  if (erroLoja != null) {
    return { ok: false, motivo: mensagemDaFalha('configs', erroLoja, FALHA_GENERICA) };
  }
  if (loja == null) return { ok: false, motivo: 'Loja não encontrada.' };

  const { data: app, error: erroApp } = await supabase
    .from('apps')
    .select('id')
    .eq('store_id', storeId)
    .maybeSingle();

  if (erroApp != null) {
    return { ok: false, motivo: mensagemDaFalha('configs', erroApp, FALHA_GENERICA) };
  }
  if (app == null) {
    // O trigger `on_store_created` cria o app junto com a loja; chegar aqui
    // sem ele significa que a loja foi criada por fora do fluxo normal.
    return { ok: false, motivo: 'Este app ainda não foi criado para a loja.' };
  }

  const [lidaMaior, lidoRascunho] = await Promise.all([
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
  /*
   * Rascunho que não se leu NÃO é "sem rascunho": decidir em cima de um nulo
   * de erro criaria um rascunho novo, com a config padrão, por cima do que o
   * lojista vinha editando — e o editor passaria a abrir esse.
   */
  const falhaDaLeitura = lidaMaior.error ?? lidoRascunho.error;
  if (falhaDaLeitura != null) {
    return { ok: false, motivo: mensagemDaFalha('configs', falhaDaLeitura, FALHA_GENERICA) };
  }
  const maior = lidaMaior.data;
  const rascunho = lidoRascunho.data;

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
    if (error != null)
      return { ok: false, motivo: mensagemDaFalha('configs', error, FALHA_GENERICA) };
  }

  // Consertar (ilegível) e atualizar (a loja mudou) regravam a mesma linha.
  if (decisao.acao === 'consertar' || decisao.acao === 'atualizar') {
    const { error } = await supabase
      .from('app_configs')
      .update({ config: decisao.config })
      .eq('app_id', app.id)
      .eq('version', decisao.version);
    if (error != null)
      return { ok: false, motivo: mensagemDaFalha('configs', error, FALHA_GENERICA) };
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

  if (error != null)
    return { ok: false, motivo: mensagemDaFalha('configs', error, FALHA_GENERICA) };
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
  const { data, error } = await supabase
    .from('app_configs')
    .select('version, published_at, config')
    .eq('app_id', appId)
    .eq('status', 'published')
    .maybeSingle();
  // "Nunca publicado" com o banco fora do ar faria o lojista publicar de novo.
  if (error != null) throw new Error(`Não foi possível ler a versão no ar: ${error.message}`);
  if (data == null) return null;

  const lida = safeParseAppConfig(data.config);
  return {
    version: data.version,
    publishedAt: data.published_at,
    config: lida.success ? lida.data : null,
  };
}

/** Histórico completo, da versão mais nova para a mais antiga. */
export async function historicoDeVersoes(
  supabase: Client,
  appId: string,
  limite = 50,
): Promise<VersaoDoHistorico[]> {
  const { data, error } = await supabase
    .from('app_configs')
    .select('version, status, published_at, published_by, created_at')
    .eq('app_id', appId)
    .order('version', { ascending: false })
    .limit(limite);
  if (error != null) throw new Error(`Não foi possível ler o histórico: ${error.message}`);

  return data.map((linha) => ({
    version: linha.version,
    status: linha.status,
    publishedAt: linha.published_at,
    publishedBy: linha.published_by,
    createdAt: linha.created_at,
  }));
}

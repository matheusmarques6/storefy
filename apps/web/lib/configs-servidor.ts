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
import { TEXTO_DO_CONFLITO, decidirRascunho } from '@/lib/rascunho';
import { FALHA_GENERICA, mensagemDaFalha } from '@/lib/erros';

type Client = SupabaseClient<Database>;

export interface RascunhoDoApp {
  appId: string;
  version: number;
  config: AppConfig;
  /**
   * O `updated_at` da linha, como este pedido a deixou. Quem grava logo em
   * seguida grava só "por cima desta" (`salvarRascunho`): uma gravação de
   * outra aba que entre no meio não é apagada em silêncio.
   */
  revisao: string;
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
  return lerOuPrepararRascunho(supabase, storeId, true);
}

/**
 * `podeRepetir`: o rascunho mudou entre a leitura e o conserto (o editor de
 * outra aba gravou no meio), ou outro pedido criou o mesmo rascunho no mesmo
 * instante. Uma segunda leitura resolve os dois; mais que isso não se repete.
 */
async function lerOuPrepararRascunho(
  supabase: Client,
  storeId: string,
  podeRepetir: boolean,
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
      .select('version, config, updated_at')
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

  let revisao = rascunho?.updated_at ?? null;

  if (decisao.acao === 'criar') {
    const { data: criado, error } = await supabase
      .from('app_configs')
      .insert({
        app_id: app.id,
        version: decisao.version,
        config: decisao.config,
        status: 'draft',
      })
      .select('updated_at')
      .single();
    if (error != null) {
      // 23505: outro pedido criou esta mesma versão agora há pouco — é ler a dele.
      if (error.code === '23505' && podeRepetir)
        return lerOuPrepararRascunho(supabase, storeId, false);
      return { ok: false, motivo: mensagemDaFalha('configs', error, FALHA_GENERICA) };
    }
    revisao = criado.updated_at;
  }

  // Consertar (ilegível) e atualizar (a loja mudou) regravam a mesma linha —
  // e só a linha como foi lida: o conserto não apaga uma gravação do editor
  // que tenha entrado no meio.
  if ((decisao.acao === 'consertar' || decisao.acao === 'atualizar') && revisao !== null) {
    const { data: regravado, error } = await supabase
      .from('app_configs')
      .update({ config: decisao.config })
      .eq('app_id', app.id)
      .eq('version', decisao.version)
      .eq('updated_at', revisao)
      .select('updated_at')
      .maybeSingle();
    if (error != null)
      return { ok: false, motivo: mensagemDaFalha('configs', error, FALHA_GENERICA) };
    if (regravado != null) revisao = regravado.updated_at;
    // Nenhuma linha: mudou entre a leitura e o conserto, e uma segunda leitura
    // decide de novo. Na segunda, é quem só pode ler (a RLS não deixa gravar):
    // ele vê o rascunho consertado, e o banco fica para quem pode editar.
    else if (podeRepetir) return lerOuPrepararRascunho(supabase, storeId, false);
  }

  if (revisao === null) {
    // Sem rascunho lido e sem um criado agora: só se `decidirRascunho` mudar.
    return { ok: false, motivo: FALHA_GENERICA };
  }

  return {
    ok: true,
    rascunho: { appId: app.id, version: decisao.version, config: decisao.config, revisao },
  };
}

export type ResultadoDaGravacao =
  | { ok: true }
  /** `conflito`: o rascunho não está mais na `revisao` dada — outra gravação entrou antes. */
  | { ok: false; conflito: boolean; motivo: string };

/**
 * Grava o rascunho editado. A versão não muda; publicar é que cria a próxima.
 *
 * Com `revisao`, só grava se o rascunho continuar nela: o que outra aba
 * gravou depois da leitura não é apagado, e a gravação volta como conflito.
 */
export async function salvarRascunho(
  supabase: Client,
  appId: string,
  version: number,
  config: AppConfig,
  revisao?: string,
): Promise<ResultadoDaGravacao> {
  let gravacao = supabase
    .from('app_configs')
    .update({ config })
    .eq('app_id', appId)
    .eq('version', version)
    .eq('status', 'draft');
  if (revisao !== undefined) gravacao = gravacao.eq('updated_at', revisao);
  const { data, error } = await gravacao.select('id').maybeSingle();

  if (error != null) {
    return {
      ok: false,
      conflito: false,
      motivo: mensagemDaFalha('configs', error, FALHA_GENERICA),
    };
  }
  if (data != null) return { ok: true };

  /*
   * Sem erro e sem linha: a RLS filtrou o UPDATE (quem só pode ler) — ou,
   * com a revisão, outra gravação entrou antes, ou outra aba publicou e esta
   * versão deixou de ser o rascunho. Para dizer qual, olha de novo.
   */
  if (revisao !== undefined) {
    const { data: atual, error: erroDaReleitura } = await supabase
      .from('app_configs')
      .select('updated_at, status')
      .eq('app_id', appId)
      .eq('version', version)
      .maybeSingle();
    if (erroDaReleitura != null) {
      return {
        ok: false,
        conflito: false,
        motivo: mensagemDaFalha('configs', erroDaReleitura, FALHA_GENERICA),
      };
    }
    if (atual != null && (atual.updated_at !== revisao || atual.status !== 'draft')) {
      return { ok: false, conflito: true, motivo: TEXTO_DO_CONFLITO };
    }
  }
  return {
    ok: false,
    conflito: false,
    motivo:
      'Não foi possível salvar. Confira se você ainda tem permissão e se esta versão continua sendo o rascunho.',
  };
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

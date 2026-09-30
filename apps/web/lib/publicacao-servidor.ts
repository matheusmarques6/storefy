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
import { safeParseAppConfig, type AppConfig } from '@storefy/config-schema';
import type { Database } from '@storefy/db';
import type { EstadoDaPublicacao } from '@/lib/checklist-de-publicacao';
import { entradaDosAjustes } from '@/lib/editor-de-config';
import type { DadosDosLinks } from '@/lib/links-do-app';
import { ESCOPO_DOS_LINKS } from '@/lib/links-do-app';
import { escoposPedidos } from '@/lib/shopify-servidor';
import { lido } from '@/lib/leitura';
import { alternativasDoIdentificador, identificadorSugerido } from '@/lib/identificador-do-app';

type Client = SupabaseClient<Database>;

/**
 * A sugestão de identificador que ainda está livre entre os apps da Storefy.
 *
 * Lê com a SERVICE ROLE porque precisa ver os identificadores das outras
 * organizações — e só eles: a consulta pede as duas colunas dos candidatos, e
 * nada mais sai daqui além do texto escolhido.
 */
export async function identificadorLivre(
  servico: Client,
  urlDaLoja: string,
  nomeDaLoja: string,
): Promise<string> {
  const candidatos = alternativasDoIdentificador(identificadorSugerido(urlDaLoja, nomeDaLoja));
  const [lidaIos, lidaAndroid] = await Promise.all([
    servico.from('apps').select('bundle_id_ios').in('bundle_id_ios', candidatos),
    servico.from('apps').select('package_android').in('package_android', candidatos),
  ]);
  const { data: noIos } = lido(lidaIos, 'os identificadores em uso');
  const { data: noAndroid } = lido(lidaAndroid, 'os identificadores em uso');

  const usados = new Set<string>();
  for (const linha of noIos ?? []) {
    if (linha.bundle_id_ios !== null) usados.add(linha.bundle_id_ios);
  }
  for (const linha of noAndroid ?? []) {
    if (linha.package_android !== null) usados.add(linha.package_android);
  }
  // Com as nove tomadas (improvável), fica a primeira: o banco recusa, e o lojista edita.
  return candidatos.find((candidato) => !usados.has(candidato)) ?? candidatos[0] ?? '';
}

export type AcaoManualDoBuild = 'play_primeiro_envio' | 'envio_manual';

export interface BuildNaLista {
  id: string;
  platform: 'ios' | 'android';
  status: Database['public']['Enums']['build_status'];
  version: string | null;
  buildNumber: number | null;
  error: string | null;
  logsUrl: string | null;
  /** Link do binário, quando o lojista precisa enviá-lo à mão. */
  artifactUrl: string | null;
  /** O passo manual que destrava este build, quando existe um. */
  acaoManual: AcaoManualDoBuild | null;
  /**
   * O que a loja de aplicativos diz desta versão (`PREPARE_FOR_SUBMISSION`,
   * `PLAY_INTERNAL`...), como o job da revisão gravou. É por ele que a tela
   * sabe se falta um passo do lojista.
   */
  storeState: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/**
 * Lê a coluna `manual_action` sem confiar no texto que veio.
 *
 * A coluna é texto com `check` no banco, e não enum: um valor que o banco
 * aceite mas a tela não conheça viraria um card em branco. Aqui ele vira
 * `null`, e a tela cai no caminho normal do erro.
 */
export function lerAcaoManual(valor: string | null): AcaoManualDoBuild | null {
  return valor === 'play_primeiro_envio' || valor === 'envio_manual' ? valor : null;
}

export interface DadosDaPublicacao {
  appId: string;
  estado: EstadoDaPublicacao;
  builds: BuildNaLista[];
  /** O que a ficha do app e a política de privacidade precisam saber da loja. */
  loja: { nome: string; url: string; temContato: boolean };
  /**
   * A config no ar — a que o revisor da Apple abre. Nula antes da primeira
   * publicação, ou se a gravada não passar mais pelo contrato.
   */
  configPublicada: AppConfig | null;
  /** Links da loja abrindo no app (Universal Links e App Links). */
  links: DadosDosLinks & { erro: string | null; dominio: string };
  /** O identificador do app nas lojas e o registro na Apple (C12). */
  identidade: {
    identificador: string | null;
    /** O número do app no App Store Connect, quando a Storefy já o achou. */
    iosAscAppId: string | null;
    /**
     * Já chegou a uma loja de aplicativos e não muda mais. O banco é quem
     * trava de verdade (migration 51); a tela só não oferece o que ele recusa.
     */
    travado: boolean;
  };
}

/** Status de build que já passaram pela loja de aplicativos (ver a trava no banco). */
const CHEGOU_A_LOJA = new Set(['finished', 'submitted', 'in_review', 'approved', 'rejected']);

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
  const { data: loja, error: erroDaLoja } = await supabase
    .from('stores')
    .select('name, primary_url, support_email, platform, shopify_scopes, shopify_conexao')
    .eq('id', storeId)
    .maybeSingle();

  const { data: app, error: erroDoApp } = await supabase
    .from('apps')
    .select(
      'id, display_name, icon_path, splash_path, bundle_id_ios, package_android, ios_asc_app_id, onesignal_app_id, current_config_version, apple_team_id, android_cert_fingerprints, ios_links_linked_at, android_links_linked_at, links_error',
    )
    .eq('store_id', storeId)
    .maybeSingle();

  // Erro não é "app não encontrado": a tela diria para recarregar sem razão.
  const falha = erroDaLoja ?? erroDoApp;
  if (falha != null) throw new Error(`Não foi possível ler a publicação: ${falha.message}`);
  if (app == null) return null;

  const [lidaPublicada, lidasContas, lidosBuilds] = await Promise.all([
    supabase
      .from('app_configs')
      .select('version, config')
      .eq('app_id', app.id)
      .eq('status', 'published')
      .maybeSingle(),
    supabase
      .from('developer_accounts')
      .select('platform, status, apple_team_id')
      .eq('org_id', orgId),
    supabase
      .from('builds')
      .select(
        'id, platform, status, version, build_number, error, logs_url, artifact_url, manual_action, store_state, created_at, finished_at',
      )
      .eq('app_id', app.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);
  // Sem ler, a tela diria "nada publicado", "nenhuma conta" e "nenhum build".
  const { data: publicada } = lido(lidaPublicada, 'a versão no ar');
  const { data: contas } = lido(lidasContas, 'as contas de desenvolvedor');
  const { data: builds } = lido(lidosBuilds, 'os builds');

  const verificada = (plataforma: 'apple' | 'google'): boolean =>
    (contas ?? []).some((conta) => conta.platform === plataforma && conta.status === 'verified');

  const lida = publicada == null ? null : safeParseAppConfig(publicada.config);
  const contaApple = (contas ?? []).find((conta) => conta.platform === 'apple');
  const pushLigado = app.onesignal_app_id !== null && app.onesignal_app_id !== '';

  const usado = (plataforma: 'ios' | 'android'): boolean =>
    (builds ?? []).some(
      (build) => build.platform === plataforma && CHEGOU_A_LOJA.has(build.status),
    );

  return {
    appId: app.id,
    configPublicada: lida?.success === true ? lida.data : null,
    identidade: {
      identificador: app.bundle_id_ios ?? app.package_android,
      iosAscAppId: app.ios_asc_app_id,
      travado: app.ios_asc_app_id !== null || usado('ios') || usado('android'),
    },
    links: {
      plataformaDaLoja: loja?.platform === 'other' ? 'other' : 'shopify',
      // O sinal de "conectada" é a coluna de escopos: a do token é invisível
      // para a sessão, e as duas andam juntas.
      shopifyConectada: loja?.shopify_scopes != null,
      escoposDaLoja: loja?.shopify_scopes ?? [],
      storefyPedeOEscopo: escoposPedidos()
        .split(',')
        .map((escopo) => escopo.trim())
        .includes(ESCOPO_DOS_LINKS),
      conexao: loja?.shopify_conexao ?? null,
      bundleIdIos: app.bundle_id_ios,
      appleTeamId: app.apple_team_id ?? contaApple?.apple_team_id ?? null,
      packageAndroid: app.package_android,
      impressoesAndroid: app.android_cert_fingerprints,
      iosVinculadoEm: app.ios_links_linked_at,
      androidVinculadoEm: app.android_links_linked_at,
      erro: app.links_error,
      dominio: loja?.primary_url ?? '',
    },
    loja: {
      nome: loja?.name ?? '',
      url: loja?.primary_url ?? '',
      temContato: (loja?.support_email ?? '') !== '',
    },
    estado: {
      nomeDoApp: app.display_name,
      versaoPublicada: publicada?.version ?? null,
      iconePronto: app.icon_path !== null && app.icon_path !== '',
      splashPronta: app.splash_path !== null && app.splash_path !== '',
      bundleIdIos: app.bundle_id_ios,
      packageAndroid: app.package_android,
      appNaApple: app.ios_asc_app_id !== null,
      appleConectada: verificada('apple'),
      googleConectada: verificada('google'),
      pushLigado,
      /*
       * Da config PUBLICADA, que é a do binário. Sem publicação ainda, o item
       * "Configuração publicada" já trava — e este é conferido depois dela.
       */
      ajustesAoAlcance:
        lida?.success !== true || entradaDosAjustes(lida.data, { push: pushLigado }) !== null,
    },
    builds: (builds ?? []).map((linha) => ({
      id: linha.id,
      platform: linha.platform,
      status: linha.status,
      version: linha.version,
      buildNumber: linha.build_number,
      error: linha.error,
      logsUrl: linha.logs_url,
      artifactUrl: linha.artifact_url,
      acaoManual: lerAcaoManual(linha.manual_action),
      storeState: linha.store_state,
      createdAt: linha.created_at,
      finishedAt: linha.finished_at,
    })),
  };
}

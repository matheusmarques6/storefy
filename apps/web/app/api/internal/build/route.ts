/**
 * `POST /api/internal/build` — o que o workflow de build precisa saber.
 *
 * É a rota mais sensível do produto: ela devolve, em claro, a chave que
 * publica na conta Apple de um cliente. O desenho reflete isso —
 *
 *   sem `BUILD_API_SECRET` a rota responde 503 e não faz nada;
 *   o segredo é conferido em tempo constante;
 *   a resposta é `no-store` e NADA do corpo entra em log, nem no de erro;
 *   um `buildId` só serve enquanto o build está na fila ou gerando.
 *
 * O `buildId` chega pelo `client_payload` do dispatch, que é público para quem
 * lê as execuções do repositório — por isso ele sozinho não vale nada sem o
 * segredo, e deixa de valer assim que o build termina.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criptografiaConfigurada, descriptografar } from '@/lib/cripto';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { urlAssinada } from '@/lib/assets-da-loja';
import {
  CABECALHO_DO_SEGREDO,
  CorpoDoBuild,
  abrirOuNulo,
  autorizarWorkflow,
  canalDaLoja,
  podeBuscarCredenciais,
  slugDoProjeto,
  type CredenciaisDoBuild,
  type DadosParaOBuild,
  type DadosParaOEnvio,
} from '@/lib/build-interno';

export const dynamic = 'force-dynamic';

const SEM_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const autorizacao = autorizarWorkflow(
    requisicao.headers.get(CABECALHO_DO_SEGREDO),
    process.env.BUILD_API_SECRET,
  );
  if (!autorizacao.ok) {
    // Só o motivo, nunca o segredo recebido nem o corpo da requisição.
    console.warn('[build-interno] recusado:', autorizacao.motivo);
    return NextResponse.json(
      { erro: 'nao_autorizado' },
      { status: autorizacao.status, headers: SEM_CACHE },
    );
  }

  if (!supabaseConfigurado || !serviceRoleConfigurada || !criptografiaConfigurada()) {
    return NextResponse.json(
      { erro: 'servidor_nao_configurado' },
      { status: 503, headers: SEM_CACHE },
    );
  }

  const analise = CorpoDoBuild.safeParse(await requisicao.json().catch(() => null));
  if (!analise.success) {
    return NextResponse.json({ erro: 'corpo_invalido' }, { status: 400, headers: SEM_CACHE });
  }

  try {
    const dados =
      analise.data.etapa === 'submit'
        ? await montarEnvio(analise.data.buildId)
        : await montar(analise.data.buildId);
    if (dados === null) {
      return NextResponse.json(
        { erro: 'build_nao_encontrado' },
        { status: 404, headers: SEM_CACHE },
      );
    }
    return NextResponse.json(dados, { headers: SEM_CACHE });
  } catch (erro) {
    /*
     * A mensagem vai para o NOSSO log e nunca para a resposta: um erro do
     * Postgres pode carregar o valor de uma coluna, e esta rota lida com
     * colunas que guardam chave privada.
     */
    console.error('[build-interno] falhou:', erro instanceof Error ? erro.message : 'desconhecido');
    return NextResponse.json({ erro: 'indisponivel' }, { status: 503, headers: SEM_CACHE });
  }
}

async function montar(buildId: string): Promise<DadosParaOBuild | null> {
  const servico = criarClientServiceRole();

  const { data: build } = await servico
    .from('builds')
    .select('id, app_id, platform, profile, status, config_version')
    .eq('id', buildId)
    .maybeSingle();

  if (build == null || !podeBuscarCredenciais(build.status, 'build')) return null;

  const { data: app } = await servico
    .from('apps')
    .select(
      'id, store_id, display_name, bundle_id_ios, package_android, expo_project_id, onesignal_app_id, device_secret_enc, icon_path, splash_path',
    )
    .eq('id', build.app_id)
    .maybeSingle();
  if (app == null) return null;

  const { data: loja } = await servico
    .from('stores')
    .select('id, org_id, name')
    .eq('id', app.store_id)
    .maybeSingle();
  if (loja == null) return null;

  const [{ data: config }, { data: contas }] = await Promise.all([
    servico
      .from('app_configs')
      .select('config, version')
      .eq('app_id', app.id)
      .eq('status', 'published')
      .maybeSingle(),
    servico
      .from('developer_accounts')
      .select(
        'platform, apple_team_id, asc_key_id, asc_issuer_id, asc_key_enc, google_service_account_enc',
      )
      .eq('org_id', loja.org_id),
  ]);

  if (config == null) return null;

  // A partir daqui o build está de fato começando.
  await servico
    .from('builds')
    .update({ status: 'building', started_at: new Date().toISOString() })
    .eq('id', build.id)
    .eq('status', 'queued');

  const tema = corDoTema(config.config);

  // Meia hora: mais do que um build leva para baixar, e curto o bastante para
  // o link não sobreviver ao log da execução.
  const [urlDoIcone, urlDaSplash] = await Promise.all([
    urlAssinada(servico, app.icon_path, 1800),
    urlAssinada(servico, app.splash_path, 1800),
  ]);

  return {
    buildId: build.id,
    storeId: loja.id,
    appId: app.id,
    platform: build.platform,
    profile: build.profile,
    nomeDoApp: app.display_name,
    bundleIdIos: app.bundle_id_ios,
    packageAndroid: app.package_android,
    expoProjectId: app.expo_project_id,
    slug: slugDoProjeto(loja.id),
    oneSignalAppId: app.onesignal_app_id,
    deviceSecret: abrirOuNulo(app.device_secret_enc, descriptografar),
    canal: canalDaLoja(loja.id, build.profile),
    corDeFundo: tema,
    config: config.config,
    urlDoIcone,
    urlDaSplash,
    credenciais: lerCredenciais(contas ?? []),
  };
}

/**
 * O que o workflow de ENVIO precisa, e nada além.
 *
 * Sem config, sem segredo do app, sem link de asset: o `eas submit` pega um
 * binário que já existe e o entrega à loja. Dar a ele a resposta da geração
 * seria espalhar segredo por um lugar que não precisa dele.
 *
 * Esta função NÃO muda o status do build. Quem diz que o envio começou é o
 * próprio workflow, pela rota de status — aqui ele só está lendo.
 */
async function montarEnvio(buildId: string): Promise<DadosParaOEnvio | null> {
  const servico = criarClientServiceRole();

  const { data: build } = await servico
    .from('builds')
    .select('id, app_id, platform, profile, status, eas_build_id')
    .eq('id', buildId)
    .maybeSingle();

  if (build == null || !podeBuscarCredenciais(build.status, 'submit')) return null;

  const { data: app } = await servico
    .from('apps')
    .select('id, store_id, display_name, bundle_id_ios, package_android, expo_project_id')
    .eq('id', build.app_id)
    .maybeSingle();
  if (app == null) return null;

  const { data: loja } = await servico
    .from('stores')
    .select('id, org_id')
    .eq('id', app.store_id)
    .maybeSingle();
  if (loja == null) return null;

  const { data: contas } = await servico
    .from('developer_accounts')
    .select(
      'platform, apple_team_id, asc_key_id, asc_issuer_id, asc_key_enc, google_service_account_enc',
    )
    .eq('org_id', loja.org_id);

  return {
    buildId: build.id,
    storeId: loja.id,
    platform: build.platform,
    profile: build.profile,
    easBuildId: build.eas_build_id,
    bundleIdIos: app.bundle_id_ios,
    packageAndroid: app.package_android,
    expoProjectId: app.expo_project_id,
    slug: slugDoProjeto(loja.id),
    nomeDoApp: app.display_name,
    credenciais: lerCredenciais(contas ?? []),
  };
}

/** As credenciais da organização, abertas, no formato que o runner espera. */
function lerCredenciais(
  contas: readonly {
    platform: string;
    apple_team_id: string | null;
    asc_key_id: string | null;
    asc_issuer_id: string | null;
    asc_key_enc: string | null;
    google_service_account_enc: string | null;
  }[],
): CredenciaisDoBuild {
  const apple = contas.find((conta) => conta.platform === 'apple');
  const google = contas.find((conta) => conta.platform === 'google');

  return {
    ascKey: abrirOuNulo(apple?.asc_key_enc ?? null, descriptografar),
    ascKeyId: apple?.asc_key_id ?? null,
    ascIssuerId: apple?.asc_issuer_id ?? null,
    appleTeamId: apple?.apple_team_id ?? null,
    googleServiceAccount: abrirOuNulo(google?.google_service_account_enc ?? null, descriptografar),
  };
}

/** A cor de fundo do tema, que preenche o alfa do ícone. */
function corDoTema(config: unknown): string {
  if (config === null || typeof config !== 'object') return '#ffffff';
  const tema = (config as Record<string, unknown>).theme;
  if (tema === null || typeof tema !== 'object') return '#ffffff';

  const fundo = (tema as Record<string, unknown>).background;
  return typeof fundo === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(fundo)
    ? fundo
    : '#ffffff';
}

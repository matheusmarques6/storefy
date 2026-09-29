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
import { log } from '@/lib/log';
import { lido } from '@/lib/leitura';
import { garantirSegredoDoApp } from '@/lib/segredo-do-app';

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
    log.aviso('build.recusado', { motivo: autorizacao.motivo });
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
    log.erro('build.falhou', { erro });
    return NextResponse.json({ erro: 'indisponivel' }, { status: 503, headers: SEM_CACHE });
  }
}

async function montar(buildId: string): Promise<DadosParaOBuild | null> {
  const servico = criarClientServiceRole();

  // `lido` em cada leitura: com o banco fora, 503 e o workflow tenta de novo
  // — e não um 404 que diria "build não encontrado" sobre um build que existe.
  const { data: build } = lido(
    await servico
      .from('builds')
      .select('id, app_id, platform, profile, status, config_version')
      .eq('id', buildId)
      .maybeSingle(),
    'o build',
  );

  if (build == null || !podeBuscarCredenciais(build.status, 'build')) return null;

  const { data: app } = lido(
    await servico
      .from('apps')
      .select(
        'id, store_id, display_name, bundle_id_ios, package_android, ios_asc_app_id, expo_project_id, onesignal_app_id, device_secret_enc, icon_path, splash_path',
      )
      .eq('id', build.app_id)
      .maybeSingle(),
    'o app',
  );
  if (app == null) return null;

  const { data: loja } = lido(
    await servico
      .from('stores')
      .select('id, org_id, name, primary_url')
      .eq('id', app.store_id)
      .maybeSingle(),
    'a loja',
  );
  if (loja == null) return null;

  const [lidaConfig, lidasContas] = await Promise.all([
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
  const { data: config } = lido(lidaConfig, 'a configuração no ar');
  const { data: contas } = lido(lidasContas, 'as contas de desenvolvedor');

  if (config == null) return null;

  /*
   * O segredo com que o app vai assinar o que manda, criado no primeiro build
   * da loja. Antes da reserva da versão: se falhar, o build fica na fila e o
   * workflow reexecutado tenta de novo, sem queimar número.
   */
  const deviceSecret = await garantirSegredoDoApp(servico, app.id, app.device_secret_enc);

  /*
   * O número vem ANTES do status: se a reserva falhar, o build continua na
   * fila, e o workflow reexecutado tenta de novo. Um build marcado como
   * "gerando" sem número sairia como 1.0.0 (1) — exatamente o que isto
   * existe para impedir.
   */
  const { data: reservada, error: erroDaReserva } = await servico.rpc('reservar_versao_do_build', {
    p_build_id: build.id,
  });
  const versao = reservada?.[0];
  if (erroDaReserva != null || versao?.numero == null || versao.versao == null) {
    throw new Error(`reserva da versão falhou: ${erroDaReserva?.message ?? 'sem retorno'}`);
  }

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
    iosAscAppId: app.ios_asc_app_id,
    expoProjectId: app.expo_project_id,
    slug: slugDoProjeto(loja.id),
    oneSignalAppId: app.onesignal_app_id,
    deviceSecret,
    canal: canalDaLoja(loja.id, build.profile),
    corDeFundo: tema,
    config: config.config,
    numeroDoBuild: versao.numero,
    versao: versao.versao,
    dominioDaLoja: dominioDe(loja.primary_url),
    esquema: slugDoProjeto(loja.id),
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

  const { data: build } = lido(
    await servico
      .from('builds')
      .select('id, app_id, platform, profile, status, eas_build_id')
      .eq('id', buildId)
      .maybeSingle(),
    'o build',
  );

  if (build == null || !podeBuscarCredenciais(build.status, 'submit')) return null;

  const { data: app } = lido(
    await servico
      .from('apps')
      .select(
        'id, store_id, display_name, bundle_id_ios, package_android, ios_asc_app_id, expo_project_id',
      )
      .eq('id', build.app_id)
      .maybeSingle(),
    'o app',
  );
  if (app == null) return null;

  const { data: loja } = lido(
    await servico.from('stores').select('id, org_id').eq('id', app.store_id).maybeSingle(),
    'a loja',
  );
  if (loja == null) return null;

  const { data: contas } = lido(
    await servico
      .from('developer_accounts')
      .select(
        'platform, apple_team_id, asc_key_id, asc_issuer_id, asc_key_enc, google_service_account_enc',
      )
      .eq('org_id', loja.org_id),
    'as contas de desenvolvedor',
  );

  return {
    buildId: build.id,
    storeId: loja.id,
    platform: build.platform,
    profile: build.profile,
    easBuildId: build.eas_build_id,
    bundleIdIos: app.bundle_id_ios,
    packageAndroid: app.package_android,
    iosAscAppId: app.ios_asc_app_id,
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

/** `https://www.loja.com.br/` vira `www.loja.com.br`. Endereço ilegível, `null`. */
function dominioDe(endereco: string): string | null {
  try {
    return new URL(endereco).hostname || null;
  } catch {
    return null;
  }
}

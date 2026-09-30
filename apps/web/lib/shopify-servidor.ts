import 'server-only';

/**
 * O que fala com a Shopify pela rede (seção 8 do plano).
 *
 * `lib/shopify.ts` decide; aqui se executa. A separação é a de sempre — as
 * decisões têm teste, as chamadas de rede têm mock — e neste caso ela também
 * mantém o segredo do app fora de qualquer módulo que o navegador possa
 * importar.
 */
import { TOPICOS_DA_LOJA, topicoNaGraphql, urlDoAdmin, type TopicoDaLoja } from '@/lib/shopify';
import { log } from '@/lib/log';

const TIMEOUT_MS = 20_000;

/** O app está configurado no Partner Dashboard? */
export function shopifyConfigurado(): boolean {
  const chave = process.env.SHOPIFY_API_KEY;
  const segredo = process.env.SHOPIFY_API_SECRET;
  return chave != null && chave !== '' && segredo != null && segredo !== '';
}

export function escoposPedidos(): string {
  const bruto = process.env.SHOPIFY_SCOPES;
  return bruto == null || bruto.trim() === ''
    ? 'read_products,read_orders,read_customers,read_fulfillments'
    : bruto.trim();
}

export type TrocaDeToken =
  { ok: true; token: string; escopos: string } | { ok: false; motivo: string };

/**
 * Troca o `code` do retorno pelo token de acesso da loja.
 *
 * O `code` vale UMA vez e por poucos minutos. Um erro aqui não tem segunda
 * chance: o lojista precisa recomeçar a conexão, e a mensagem tem de dizer
 * isso em vez de mostrar o corpo da resposta da Shopify.
 */
export async function trocarCodePorToken(
  shop: string,
  code: string,
  buscador: typeof fetch = fetch,
): Promise<TrocaDeToken> {
  const clientId = process.env.SHOPIFY_API_KEY ?? '';
  const clientSecret = process.env.SHOPIFY_API_SECRET ?? '';
  if (clientId === '' || clientSecret === '') {
    return { ok: false, motivo: 'A Storefy ainda não terminou de configurar o app da Shopify.' };
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  try {
    const resposta = await buscador(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      signal: controle.signal,
    });

    if (!resposta.ok) {
      /*
       * O corpo do erro da Shopify não vai para a tela: ele às vezes ecoa o
       * `client_secret` que mandamos. O motivo é escrito por nós.
       */
      return {
        ok: false,
        motivo:
          resposta.status === 400
            ? 'A autorização expirou. Clique em conectar de novo — o código da Shopify vale poucos minutos.'
            : 'A Shopify não respondeu como esperado. Tente conectar de novo.',
      };
    }

    const corpo: unknown = await resposta.json();
    return lerRespostaDoToken(corpo);
  } catch {
    return { ok: false, motivo: 'Não conseguimos falar com a Shopify agora. Tente de novo.' };
  } finally {
    clearTimeout(relogio);
  }
}

/** Lê o corpo da troca sem confiar no formato. */
export function lerRespostaDoToken(corpo: unknown): TrocaDeToken {
  if (corpo === null || typeof corpo !== 'object') {
    return { ok: false, motivo: 'A Shopify respondeu algo que não entendemos.' };
  }

  const campos = corpo as { access_token?: unknown; scope?: unknown };
  const token = campos.access_token;
  if (typeof token !== 'string' || token === '') {
    return { ok: false, motivo: 'A Shopify não devolveu o token de acesso.' };
  }

  return { ok: true, token, escopos: typeof campos.scope === 'string' ? campos.scope : '' };
}

export interface ResultadoDosWebhooks {
  registrados: TopicoDaLoja[];
  falharam: TopicoDaLoja[];
  /**
   * A Shopify recusou o token (o app foi desinstalado, o acesso revogado):
   * tentar de novo não adianta, só conectar a loja de novo.
   */
  acessoRecusado: boolean;
  /**
   * A Shopify não respondeu nem para dizer o que a loja tem: não se sabe o que
   * falta, e dizer "faltam todos" ao lojista seria alarme falso.
   */
  semResposta: boolean;
}

const LISTAR_AVISOS = `query AvisosDaStorefy($uri: String!) {
  webhookSubscriptions(first: 50, uri: $uri) {
    nodes { id topic }
  }
}`;

const REGISTRAR_AVISO = `mutation RegistrarAviso($topic: WebhookSubscriptionTopic!, $uri: String!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri, format: JSON }) {
    webhookSubscription { id }
    userErrors { field message }
  }
}`;

const APAGAR_AVISO = `mutation ApagarAviso($id: ID!) {
  webhookSubscriptionDelete(id: $id) {
    deletedWebhookSubscriptionId
    userErrors { field message }
  }
}`;

type AvisosNaLoja =
  | { ok: true; avisos: { id: string; topic: string }[] }
  | { ok: false; causa: 'sem-permissao' | 'dados-protegidos' | 'fora-do-ar' };

/** Os avisos da Storefy que a loja tem hoje: os que apontam para a NOSSA url. */
async function avisosNaLoja(
  shop: string,
  token: string,
  urlDoWebhook: string,
  buscador: typeof fetch,
): Promise<AvisosNaLoja> {
  const resposta = await consultarAdmin(
    shop,
    token,
    LISTAR_AVISOS,
    { uri: urlDoWebhook },
    buscador,
  );
  if (!resposta.ok) return { ok: false, causa: resposta.causa };

  const conexao = resposta.dados.webhookSubscriptions as { nodes?: unknown } | null | undefined;
  const nos = Array.isArray(conexao?.nodes) ? conexao.nodes : [];
  const avisos: { id: string; topic: string }[] = [];
  for (const no of nos) {
    if (no === null || typeof no !== 'object') continue;
    const { id, topic } = no as Record<string, unknown>;
    if (typeof id === 'string' && typeof topic === 'string') avisos.push({ id, topic });
  }
  return { ok: true, avisos };
}

/**
 * Registra os avisos da loja — só os que faltam.
 *
 * TODOS APONTAM PARA A MESMA URL. A Shopify diz qual é qual no cabeçalho
 * `x-shopify-topic`, e uma rota só significa uma conferência de assinatura só
 * — o lugar onde um erro custa caro.
 *
 * Lê primeiro o que existe e cria só o que falta: reconectar, e a conferência
 * de hora em hora, não duplicam nada nem dependem do texto de um erro. Pela
 * GraphQL: a API REST da Shopify é legado, e app público novo só usa GraphQL.
 *
 * Um tópico que falha NÃO derruba os outros: a loja com `orders/create`
 * registrado e `products/update` não é uma loja quebrada, é uma loja sem o
 * aviso de volta ao estoque. Quem chama decide o que fazer com a lista.
 */
export async function registrarWebhooks(
  shop: string,
  token: string,
  urlDoWebhook: string,
  buscador: typeof fetch = fetch,
): Promise<ResultadoDosWebhooks> {
  const existentes = await avisosNaLoja(shop, token, urlDoWebhook, buscador);
  if (!existentes.ok) {
    return {
      registrados: [],
      falharam: [...TOPICOS_DA_LOJA],
      acessoRecusado: existentes.causa === 'sem-permissao',
      semResposta: existentes.causa !== 'sem-permissao',
    };
  }

  const temos = new Set(existentes.avisos.map((aviso) => aviso.topic));
  const registrados: TopicoDaLoja[] = [];
  const falharam: TopicoDaLoja[] = [];

  for (const topico of TOPICOS_DA_LOJA) {
    if (temos.has(topicoNaGraphql(topico))) {
      registrados.push(topico);
      continue;
    }
    const resposta = await consultarAdmin(
      shop,
      token,
      REGISTRAR_AVISO,
      { topic: topicoNaGraphql(topico), uri: urlDoWebhook },
      buscador,
    );
    const deuCerto =
      resposta.ok &&
      mutacaoDeuCerto(resposta.dados, 'webhookSubscriptionCreate', 'shopify.aviso-recusado');
    if (deuCerto) registrados.push(topico);
    else falharam.push(topico);
  }

  return { registrados, falharam, acessoRecusado: false, semResposta: false };
}

/**
 * Apaga os avisos que apontam para a Storefy.
 *
 * Chamado quando o lojista desconecta a loja pelo painel, ou a exclui. Sem
 * isto, a Shopify continua mandando pedido para cá depois da desconexão — e o
 * lojista que desligou a integração tem todo o direito de esperar que ela
 * pare.
 *
 * Só os que apontam para a NOSSA url: uma loja pode ter avisos de outros apps
 * no mesmo tópico, e apagá-los seria quebrar a ferramenta de terceiro.
 *
 * Melhor esforço, de propósito: o token pode já estar revogado, e nesse caso
 * não há aviso nosso de pé para apagar. Quem chama segue em frente.
 */
export async function apagarWebhooks(
  shop: string,
  token: string,
  urlDoWebhook: string,
  buscador: typeof fetch = fetch,
): Promise<number> {
  const existentes = await avisosNaLoja(shop, token, urlDoWebhook, buscador);
  if (!existentes.ok) return 0;

  let apagados = 0;
  for (const aviso of existentes.avisos) {
    const resposta = await consultarAdmin(shop, token, APAGAR_AVISO, { id: aviso.id }, buscador);
    if (
      resposta.ok &&
      mutacaoDeuCerto(resposta.dados, 'webhookSubscriptionDelete', 'shopify.aviso-nao-apagado')
    ) {
      apagados += 1;
    }
  }
  return apagados;
}

/** Roda uma chamada com prazo. `null` quando ela falha ou estoura o tempo. */
async function buscarComPrazo(
  chamada: (sinal: AbortSignal) => Promise<Response>,
): Promise<Response | null> {
  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  try {
    return await chamada(controle.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(relogio);
  }
}

// ------------------------------------------------ links da loja no app

/** O que cadastrar no domínio da loja. `null` pula a plataforma. */
export interface AlvoDosLinks {
  apple: { appId: string } | null;
  android: { applicationId: string; impressoes: readonly string[] } | null;
}

export type ResultadoDaPlataforma = 'vinculado' | 'falhou' | null;

export interface ResultadoDosLinks {
  ios: ResultadoDaPlataforma;
  android: ResultadoDaPlataforma;
  /** O motivo da falha, em português, para a tela. `null` quando deu certo. */
  erro: string | null;
}

/** Um cadastro que a Shopify já tem para esta loja. */
interface AppNoDominio {
  id: string;
  tipo: 'apple' | 'android';
  /** `appId` da Apple ou `applicationId` do Android. */
  identificador: string;
}

/**
 * `causa` diz o que resolve a recusa, para quem chama escolher a frase: a
 * permissão da loja (reconectar), a aprovação de dados de cliente que a
 * Shopify dá ao app da Storefy (nada que o lojista faça), ou só tempo.
 */
export type RespostaDoAdmin =
  | { ok: true; dados: Record<string, unknown> }
  | { ok: false; motivo: string; causa: 'sem-permissao' | 'dados-protegidos' | 'fora-do-ar' };

const MOTIVO_SEM_PERMISSAO =
  'A Shopify recusou: falta a permissão para publicar os links. Reconecte a loja em Integrações.';
const MOTIVO_FORA_DO_AR = 'A Shopify não respondeu agora. Tente de novo em alguns minutos.';

/**
 * Uma chamada à Admin API em GraphQL.
 *
 * A GraphQL da Shopify responde 200 mesmo quando nega o acesso — a recusa vem
 * em `errors`. Tratar só o status HTTP faria uma permissão faltando parecer
 * sucesso.
 */
export async function consultarAdmin(
  shop: string,
  token: string,
  consulta: string,
  variaveis: Record<string, unknown>,
  buscador: typeof fetch,
): Promise<RespostaDoAdmin> {
  const resposta = await buscarComPrazo((sinal) =>
    buscador(urlDoAdmin(shop, 'graphql.json'), {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query: consulta, variables: variaveis }),
      signal: sinal,
    }),
  );

  if (resposta === null) return FORA_DO_AR;
  if (resposta.status === 401 || resposta.status === 403) return SEM_PERMISSAO;
  if (!resposta.ok) return FORA_DO_AR;

  const corpo: unknown = await resposta.json().catch(() => null);
  if (corpo === null || typeof corpo !== 'object') return FORA_DO_AR;
  const { data, errors } = corpo as { data?: unknown; errors?: unknown };

  if (Array.isArray(errors) && errors.length > 0) {
    const texto = JSON.stringify(errors);
    // O corpo do erro é da Shopify, em inglês e técnico: vai para o log, e a
    // tela recebe a frase que o lojista entende.
    log.aviso('shopify-admin.recusou', { resposta: texto.slice(0, 500) });
    /*
     * Dados de cliente são "protegidos" para app público: sem a aprovação da
     * Shopify ao app da Storefy, a recusa vem assim — e reconectar a loja não
     * muda nada, por isso ela não vira "falta permissão".
     */
    if (/protected[-_ ]customer[-_ ]data|not approved to (?:access|use)/i.test(texto)) {
      return { ok: false, motivo: MOTIVO_FORA_DO_AR, causa: 'dados-protegidos' };
    }
    return /access|scope|denied|permission/i.test(texto) ? SEM_PERMISSAO : FORA_DO_AR;
  }

  return data !== null && typeof data === 'object'
    ? { ok: true, dados: data as Record<string, unknown> }
    : FORA_DO_AR;
}

const SEM_PERMISSAO = {
  ok: false,
  motivo: MOTIVO_SEM_PERMISSAO,
  causa: 'sem-permissao',
} as const satisfies RespostaDoAdmin;
const FORA_DO_AR = {
  ok: false,
  motivo: MOTIVO_FORA_DO_AR,
  causa: 'fora-do-ar',
} as const satisfies RespostaDoAdmin;

const LISTAR_APPS = `query AppsNoDominio {
  mobilePlatformApplications(first: 50) {
    nodes {
      __typename
      ... on AppleApplication { id appId }
      ... on AndroidApplication { id applicationId }
    }
  }
}`;

const CRIAR_APP = `mutation CadastrarApp($input: MobilePlatformApplicationCreateInput!) {
  mobilePlatformApplicationCreate(input: $input) {
    mobilePlatformApplication { __typename }
    userErrors { field message }
  }
}`;

const ATUALIZAR_APP = `mutation AtualizarApp($id: ID!, $input: MobilePlatformApplicationUpdateInput!) {
  mobilePlatformApplicationUpdate(id: $id, input: $input) {
    mobilePlatformApplication { __typename }
    userErrors { field message }
  }
}`;

/** Os cadastros que a loja já tem, lidos sem confiar no formato. */
function lerAppsNoDominio(dados: Record<string, unknown>): AppNoDominio[] {
  const conexao = dados.mobilePlatformApplications as { nodes?: unknown } | null | undefined;
  const nos = Array.isArray(conexao?.nodes) ? conexao.nodes : [];
  const apps: AppNoDominio[] = [];

  for (const no of nos) {
    if (no === null || typeof no !== 'object') continue;
    const { __typename, id, appId, applicationId } = no as Record<string, unknown>;
    if (typeof id !== 'string') continue;
    if (__typename === 'AppleApplication' && typeof appId === 'string') {
      apps.push({ id, tipo: 'apple', identificador: appId });
    } else if (__typename === 'AndroidApplication' && typeof applicationId === 'string') {
      apps.push({ id, tipo: 'android', identificador: applicationId });
    }
  }
  return apps;
}

/** A mutação deu certo? Olha os `userErrors`, que chegam com status 200. */
function mutacaoDeuCerto(
  dados: Record<string, unknown>,
  campo: string,
  evento = 'shopify-links.cadastro-recusado',
): boolean {
  const resultado = dados[campo] as { userErrors?: unknown } | null | undefined;
  if (resultado === null || resultado === undefined) return false;
  const erros = resultado.userErrors;
  if (Array.isArray(erros) && erros.length > 0) {
    log.aviso(evento, { erros });
    return false;
  }
  return true;
}

/**
 * Cadastra o app no domínio da loja, para a Shopify publicar os arquivos de
 * Universal Links e App Links.
 *
 * IDEMPOTENTE: um cadastro que já existe para o mesmo app é ATUALIZADO, e não
 * duplicado — o lojista clica de novo, o build troca a impressão, a conexão é
 * refeita. Cadastros de OUTROS apps da loja não são tocados: podem ser de outra
 * ferramenta, e apagá-los quebraria os links dela.
 */
export async function vincularAppNoDominio(
  shop: string,
  token: string,
  alvo: AlvoDosLinks,
  buscador: typeof fetch = fetch,
): Promise<ResultadoDosLinks> {
  const lista = await consultarAdmin(shop, token, LISTAR_APPS, {}, buscador);
  if (!lista.ok) {
    return {
      ios: alvo.apple === null ? null : 'falhou',
      android: alvo.android === null ? null : 'falhou',
      erro: lista.motivo,
    };
  }
  const existentes = lerAppsNoDominio(lista.dados);

  let erro: string | null = null;

  async function cadastrar(
    tipo: 'apple' | 'android',
    identificador: string,
    entrada: Record<string, unknown>,
  ): Promise<ResultadoDaPlataforma> {
    const existente = existentes.find(
      (app) => app.tipo === tipo && app.identificador.toLowerCase() === identificador.toLowerCase(),
    );
    const resposta =
      existente === undefined
        ? await consultarAdmin(shop, token, CRIAR_APP, { input: { [tipo]: entrada } }, buscador)
        : await consultarAdmin(
            shop,
            token,
            ATUALIZAR_APP,
            { id: existente.id, input: { [tipo]: entrada } },
            buscador,
          );

    const campo =
      existente === undefined
        ? 'mobilePlatformApplicationCreate'
        : 'mobilePlatformApplicationUpdate';
    if (resposta.ok && mutacaoDeuCerto(resposta.dados, campo)) return 'vinculado';

    erro ??= resposta.ok
      ? 'A Shopify não aceitou o cadastro do app. Confira os identificadores e tente de novo.'
      : resposta.motivo;
    return 'falhou';
  }

  const ios =
    alvo.apple === null
      ? null
      : await cadastrar('apple', alvo.apple.appId, {
          appId: alvo.apple.appId,
          universalLinksEnabled: true,
          // Obrigatório na criação; o app não usa senha compartilhada.
          sharedWebCredentialsEnabled: false,
        });

  const android =
    alvo.android === null
      ? null
      : await cadastrar('android', alvo.android.applicationId, {
          applicationId: alvo.android.applicationId,
          sha256CertFingerprints: [...alvo.android.impressoes],
          appLinksEnabled: true,
        });

  return { ios, android, erro };
}

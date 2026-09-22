import 'server-only';

/**
 * O app personalizado do lojista, trocado por um token de acesso.
 *
 * O caminho é `grant_type=client_credentials`: o lojista cria um app na conta
 * Shopify DELE, instala na própria loja e nos entrega Client ID e Client
 * Secret. Trocamos os dois por um token, sem passar por revisão da Shopify e
 * sem o lojista precisar aprovar nada numa tela nossa.
 *
 * O QUE MUDA EM RELAÇÃO AO OAUTH, e é a razão de este arquivo existir:
 *
 *   o token vale 24 HORAS (`expires_in` 86399), e não até a desinstalação.
 *   Renovar é repetir esta mesma chamada — não há refresh token;
 *
 *   o segredo que assina os webhooks passa a ser o Client Secret DESTE app,
 *   e não o `SHOPIFY_API_SECRET` da Storefy. Cada loja tem o seu.
 *
 * Desde janeiro de 2026 o app personalizado não mostra mais um token pronto
 * no admin da Shopify: o Client Secret é o que o lojista tem para dar, e a
 * troca aqui é o único jeito de chegar no token.
 */
import { ehDominioDeLoja } from '@/lib/shopify';

/** O que a Shopify devolve, e quanto tempo ele dura. */
export interface TokenDeCredenciais {
  token: string;
  /** Escopos concedidos, na ordem em que a Shopify devolveu. */
  escopos: string[];
  /**
   * Quando ele vence, em ISO — ou `null` quando não vence.
   *
   * Os dois caminhos existem de verdade: o token de `client_credentials` vale
   * 24 horas, e o do app do admin da loja vale até ser revogado. `null` é o
   * que faz `precisaRenovar` devolver false e ninguém tentar renovar o que
   * não tem como.
   */
  venceEm: string | null;
}

export type TrocaDeCredenciais =
  | { ok: true; valor: TokenDeCredenciais }
  /** Motivo em pt-BR, pronto para a tela. */
  | { ok: false; motivo: string };

const TIMEOUT_MS = 15_000;

/**
 * Quanto dura o token quando a Shopify não diz.
 *
 * Curto de propósito: errar para menos custa uma renovação a mais, e errar
 * para mais custa uma chamada falhando na cara do lojista.
 */
const VIDA_PADRAO_S = 3600;

/**
 * Troca Client ID + Client Secret pelo token de acesso da loja.
 *
 * `buscador` é injetável porque este é um dos dois lugares do produto que
 * falam com a conta Shopify de um cliente: testar a tradução de cada erro sem
 * uma loja de verdade é o que impede que "credencial errada" chegue ao
 * lojista como "erro 401".
 */
export async function trocarCredenciaisPorToken(
  shop: string,
  clientId: string,
  clientSecret: string,
  buscador: typeof fetch = fetch,
): Promise<TrocaDeCredenciais> {
  /*
   * O domínio vira o HOST de uma chamada que leva o segredo do app do
   * lojista. Sem este crivo, um domínio digitado errado — ou escolhido por
   * quem quisesse — mandaria a credencial dele para outro servidor.
   */
  if (!ehDominioDeLoja(shop)) {
    return { ok: false, motivo: 'Use o endereço que termina em .myshopify.com.' };
  }
  if (clientId.trim() === '' || clientSecret.trim() === '') {
    return { ok: false, motivo: 'Preencha o Client ID e o Client Secret do app.' };
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  let resposta: Response;
  try {
    resposta = await buscador(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
      }).toString(),
      signal: controle.signal,
    });
  } catch {
    return { ok: false, motivo: 'Não conseguimos falar com a Shopify agora. Tente de novo.' };
  } finally {
    clearTimeout(relogio);
  }

  if (!resposta.ok) {
    return { ok: false, motivo: await traduzirFalha(resposta) };
  }

  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch {
    return { ok: false, motivo: 'A Shopify respondeu algo que não entendemos. Tente de novo.' };
  }

  return lerResposta(corpo);
}

/**
 * O erro da Shopify vira instrução, e nunca o corpo cru.
 *
 * O corpo cru serve ao suporte, não ao lojista: "401 Unauthorized" não diz a
 * ele o que fazer, e o que ele precisa saber é se errou ao copiar a
 * credencial ou se esqueceu de instalar o app.
 *
 * O texto é lido porque a Shopify devolve 400 para coisas MUITO diferentes —
 * credencial errada, app não instalado, e app que nem suporta este tipo de
 * troca — e só o corpo separa uma da outra.
 *
 * DUAS COISAS SOBRE O QUE SAI DAQUI. O corpo inteiro vai para o LOG DO
 * SERVIDOR, e não para a tela: sem ele, uma recusa que não caiu em nenhum
 * caso conhecido é indiagnosticável, e foi exatamente o que aconteceu na
 * primeira tentativa real. E o CÓDIGO do erro — `invalid_client` e afins —
 * entra na mensagem quando não reconhecemos o caso: é uma palavra de um
 * vocabulário fechado da Shopify, não carrega segredo, e é o que transforma
 * "não funcionou" em algo que o suporte procura.
 */
async function traduzirFalha(resposta: Response): Promise<string> {
  const texto = await resposta.text().catch(() => '');

  // Só para o nosso log. O corpo pode ser grande; o começo basta.
  console.warn('[shopify-credenciais] recusado:', resposta.status, texto.slice(0, 500));

  if (/application_cannot_be_found/i.test(texto)) {
    return 'Não achamos esse app na loja. Confira o Client ID e veja se o app está instalado nela.';
  }

  /*
   * O app existe mas não faz esta troca. É o que acontece com o app
   * personalizado criado DENTRO do admin da loja (Configurações › Apps ›
   * Desenvolver apps): ele entrega um token de acesso pronto e não aceita
   * `client_credentials`. Só o app criado no painel de desenvolvedor aceita.
   *
   * Vale uma mensagem própria porque o lojista fez tudo certo — só no lugar
   * errado —, e "confira as credenciais" o mandaria conferir para sempre uma
   * credencial que está correta.
   */
  if (/unsupported_grant_type|unauthorized_client/i.test(texto)) {
    return 'Esse app não aceita este tipo de conexão. Ele precisa ser criado no painel de desenvolvedor da Shopify (dev.shopify.com), e não dentro do admin da loja. Se o seu app mostra um "token de acesso da Admin API", use o campo de token aqui embaixo.';
  }

  if (/invalid_client/i.test(texto) || resposta.status === 401 || resposta.status === 403) {
    return 'Client ID ou Client Secret não conferem. Copie os dois de novo no painel da Shopify.';
  }
  if (resposta.status === 404) {
    return 'Essa loja não existe na Shopify. Confira o endereço .myshopify.com.';
  }
  if (resposta.status === 429) {
    return 'A Shopify pediu para esperar um pouco. Tente de novo em alguns instantes.';
  }
  if (resposta.status >= 500) {
    return 'A Shopify está fora do ar agora. Tente de novo em alguns minutos.';
  }

  const codigo = codigoDoErro(texto);
  return codigo === null
    ? 'A Shopify recusou as credenciais. Confira o Client ID e o Client Secret e tente de novo.'
    : `A Shopify recusou as credenciais (${codigo}). Confira o Client ID e o Client Secret, e se o app está instalado na loja.`;
}

/**
 * O código do erro, quando o corpo é o JSON de OAuth que a Shopify costuma
 * mandar.
 *
 * Só o campo `error`, e só se ele parecer um código: o `error_description`
 * é texto livre e já veio com valor de credencial dentro. Letras, números,
 * `_` e `-`, no máximo 40 — o formato de todo código de OAuth.
 */
export function codigoDoErro(corpo: string): string | null {
  const achado = /"error"\s*:\s*"([a-z0-9_-]{1,40})"/i.exec(corpo);
  return achado?.[1] ?? null;
}

/**
 * Lê a resposta da troca.
 *
 * Separada para ser testável sem rede, e porque o formato do `expires_in`
 * varia: a Shopify já mandou número e já mandou texto, e `Number('')` é 0 —
 * um token que nasceria vencido.
 */
export function lerResposta(corpo: unknown): TrocaDeCredenciais {
  if (typeof corpo !== 'object' || corpo === null) {
    return { ok: false, motivo: 'A Shopify respondeu algo que não entendemos. Tente de novo.' };
  }

  const dados = corpo as Record<string, unknown>;
  const token = typeof dados.access_token === 'string' ? dados.access_token.trim() : '';

  if (token === '') {
    return { ok: false, motivo: 'A Shopify não devolveu o token de acesso. Tente de novo.' };
  }

  const escopos =
    typeof dados.scope === 'string'
      ? dados.scope
          .split(',')
          .map((escopo) => escopo.trim())
          .filter((escopo) => escopo !== '')
      : [];

  const bruto = Number(dados.expires_in);
  const segundos = Number.isFinite(bruto) && bruto > 0 ? Math.floor(bruto) : VIDA_PADRAO_S;

  return {
    ok: true,
    valor: {
      token,
      escopos,
      venceEm: new Date(Date.now() + segundos * 1000).toISOString(),
    },
  };
}

/**
 * Está na hora de renovar?
 *
 * A folga existe porque renovar no instante do vencimento é renovar tarde: a
 * chamada que dispara a renovação é a mesma que vai usar o token, e um token
 * que vence no meio dela falha do mesmo jeito. Dez minutos cobrem qualquer
 * chamada nossa com sobra.
 */
export const FOLGA_DA_RENOVACAO_MS = 10 * 60 * 1000;

export function precisaRenovar(
  venceEm: string | null | undefined,
  agora: number = Date.now(),
): boolean {
  // Sem prazo é conexão por OAuth: o token dela não vence.
  if (venceEm == null || venceEm === '') return false;

  const prazo = Date.parse(venceEm);
  // Data ilegível é tratada como vencida: renovar à toa custa uma chamada,
  // e não renovar custa a integração parada sem ninguém entender por quê.
  if (Number.isNaN(prazo)) return true;

  return prazo - agora <= FOLGA_DA_RENOVACAO_MS;
}

/**
 * Confere um token de acesso que o lojista já tem em mãos.
 *
 * O app personalizado criado DENTRO do admin da loja (Configurações › Apps e
 * canais de venda › Desenvolver apps) não faz `client_credentials`: ele
 * mostra um token pronto, que não vence. É o app que a maior parte dos
 * lojistas sabe criar, e recusá-lo seria recusar o caminho mais fácil.
 *
 * A conferência é o próprio `access_scopes.json`: ele responde com as
 * permissões concedidas, então a MESMA chamada prova que o token vale e diz o
 * que ele abre. Pedir `shop.json` provaria só a primeira metade, e a segunda é
 * a que impede uma loja de conectar sem `read_orders` e nunca trazer pedido.
 */
export async function conferirTokenDeAcesso(
  shop: string,
  token: string,
  buscador: typeof fetch = fetch,
): Promise<TrocaDeCredenciais> {
  if (!ehDominioDeLoja(shop)) {
    return { ok: false, motivo: 'Use o endereço que termina em .myshopify.com.' };
  }
  if (token.trim() === '') {
    return { ok: false, motivo: 'Cole o token de acesso da Admin API.' };
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  let resposta: Response;
  try {
    resposta = await buscador(`https://${shop}/admin/oauth/access_scopes.json`, {
      headers: { 'X-Shopify-Access-Token': token.trim(), Accept: 'application/json' },
      signal: controle.signal,
    });
  } catch {
    return { ok: false, motivo: 'Não conseguimos falar com a Shopify agora. Tente de novo.' };
  } finally {
    clearTimeout(relogio);
  }

  if (resposta.status === 401 || resposta.status === 403) {
    return {
      ok: false,
      motivo:
        'A Shopify não aceitou esse token. Copie de novo o token de acesso da Admin API — ele aparece uma vez só, e revelá-lo outra vez pode gerar um novo.',
    };
  }
  if (!resposta.ok) {
    return { ok: false, motivo: await traduzirFalha(resposta) };
  }

  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch {
    return { ok: false, motivo: 'A Shopify respondeu algo que não entendemos. Tente de novo.' };
  }

  return {
    ok: true,
    valor: {
      token: token.trim(),
      escopos: lerEscopos(corpo),
      /*
       * Sem prazo, de propósito: o token do app do admin não vence, e é isso
       * que `shopify_token_expires_at` nulo significa no resto do código —
       * `precisaRenovar` devolve false e ninguém tenta renovar o que não tem
       * como ser renovado.
       */
      venceEm: null,
    },
  };
}

/** Os handles de `access_scopes.json`, sem confiar no formato. */
export function lerEscopos(corpo: unknown): string[] {
  if (typeof corpo !== 'object' || corpo === null) return [];

  const lista = (corpo as { access_scopes?: unknown }).access_scopes;
  if (!Array.isArray(lista)) return [];

  return lista
    .map((item) => {
      if (typeof item !== 'object' || item === null) return '';
      // Só texto: um `handle` que veio número ou objeto não é um escopo, e
      // `String()` em cima dele viraria "[object Object]" na lista.
      const handle = (item as { handle?: unknown }).handle;
      return typeof handle === 'string' ? handle.trim() : '';
    })
    .filter((handle) => handle !== '');
}

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
  /** Quando ele vence, em ISO. */
  venceEm: string;
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
 * O texto é lido porque a Shopify devolve 400 tanto para credencial errada
 * quanto para app não instalado, e só o corpo separa os dois. Ele não sai
 * daqui.
 */
async function traduzirFalha(resposta: Response): Promise<string> {
  const texto = await resposta.text().catch(() => '');

  if (/application_cannot_be_found/i.test(texto)) {
    return 'Não achamos esse app na loja. Confira o Client ID e veja se o app está instalado nela.';
  }
  if (resposta.status === 401 || resposta.status === 403) {
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
  return 'A Shopify recusou as credenciais. Confira o Client ID e o Client Secret e tente de novo.';
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

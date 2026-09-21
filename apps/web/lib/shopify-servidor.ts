import 'server-only';

/**
 * O que fala com a Shopify pela rede (seção 8 do plano).
 *
 * `lib/shopify.ts` decide; aqui se executa. A separação é a de sempre — as
 * decisões têm teste, as chamadas de rede têm mock — e neste caso ela também
 * mantém o segredo do app fora de qualquer módulo que o navegador possa
 * importar.
 */
import { TOPICOS, urlDoAdmin, type Topico } from '@/lib/shopify';

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
  registrados: Topico[];
  falharam: Topico[];
}

/**
 * Registra os webhooks da loja.
 *
 * TODOS OS TÓPICOS APONTAM PARA A MESMA URL. A Shopify diz qual é qual no
 * cabeçalho `x-shopify-topic`, e uma rota só significa uma conferência de
 * assinatura só — o lugar onde um erro custa caro.
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
  const registrados: Topico[] = [];
  const falharam: Topico[] = [];

  for (const topico of TOPICOS) {
    const ok = await registrarUm(shop, token, urlDoWebhook, topico, buscador);
    if (ok) registrados.push(topico);
    else falharam.push(topico);
  }

  return { registrados, falharam };
}

async function registrarUm(
  shop: string,
  token: string,
  urlDoWebhook: string,
  topico: Topico,
  buscador: typeof fetch,
): Promise<boolean> {
  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  try {
    const resposta = await buscador(urlDoAdmin(shop, 'webhooks.json'), {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ webhook: { topic: topico, address: urlDoWebhook, format: 'json' } }),
      signal: controle.signal,
    });

    /*
     * 422 com "for this topic and address" significa que ELE JÁ EXISTE — o
     * lojista reinstalou o app. Tratar isso como falha faria uma reinstalação
     * parecer uma conexão quebrada.
     */
    if (resposta.status === 422) {
      const texto = await resposta.text();
      return /already been taken|already exists/i.test(texto);
    }

    return resposta.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Apaga os webhooks que apontam para a Storefy.
 *
 * Chamado quando o lojista desconecta a loja pelo painel. Sem isto, a Shopify
 * continua mandando pedido para cá depois da desconexão — e o lojista que
 * desligou a integração tem todo o direito de esperar que ela pare.
 *
 * Só os que apontam para a NOSSA url: uma loja pode ter webhooks de outros
 * apps no mesmo tópico, e apagá-los seria quebrar a ferramenta de terceiro.
 *
 * Melhor esforço, de propósito: o token pode já estar revogado, e nesse caso
 * não há webhook nosso de pé para apagar. Quem chama segue em frente.
 */
export async function apagarWebhooks(
  shop: string,
  token: string,
  urlDoWebhook: string,
  buscador: typeof fetch = fetch,
): Promise<number> {
  const ids = await listarWebhooks(shop, token, urlDoWebhook, buscador);

  let apagados = 0;
  for (const id of ids) {
    if (await apagarUm(shop, token, id, buscador)) apagados += 1;
  }
  return apagados;
}

async function listarWebhooks(
  shop: string,
  token: string,
  urlDoWebhook: string,
  buscador: typeof fetch,
): Promise<number[]> {
  const resposta = await buscarComPrazo((sinal) =>
    buscador(urlDoAdmin(shop, 'webhooks.json?limit=250'), {
      headers: { 'X-Shopify-Access-Token': token, Accept: 'application/json' },
      signal: sinal,
    }),
  );

  if (resposta?.ok !== true) return [];

  const corpo: unknown = await resposta.json().catch(() => null);
  const lista = (corpo as { webhooks?: unknown } | null)?.webhooks;
  if (!Array.isArray(lista)) return [];

  const ids: number[] = [];
  for (const item of lista) {
    if (item === null || typeof item !== 'object') continue;
    const { id, address } = item as { id?: unknown; address?: unknown };
    if (typeof id === 'number' && address === urlDoWebhook) ids.push(id);
  }
  return ids;
}

async function apagarUm(
  shop: string,
  token: string,
  id: number,
  buscador: typeof fetch,
): Promise<boolean> {
  const resposta = await buscarComPrazo((sinal) =>
    buscador(urlDoAdmin(shop, `webhooks/${String(id)}.json`), {
      method: 'DELETE',
      headers: { 'X-Shopify-Access-Token': token, Accept: 'application/json' },
      signal: sinal,
    }),
  );

  // 404 é sucesso: ele já não existe, que é exatamente o estado desejado.
  return resposta?.ok === true || resposta?.status === 404;
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

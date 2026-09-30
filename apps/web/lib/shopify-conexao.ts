import 'server-only';

/**
 * A conexão da loja com a Shopify, seja qual for o caminho por onde veio.
 *
 * O produto tem duas formas de conectar e o resto do código não deve precisar
 * saber qual é qual. Este arquivo é a costura: quem quer falar com a Shopify
 * pede `tokenDaLoja` e recebe um token válido; quem recebe um webhook pede
 * `segredoDoWebhook` e recebe o segredo certo daquela loja.
 *
 * DUAS DIFERENÇAS ENTRE OS CAMINHOS, e as duas moram aqui:
 *
 *   o token do OAuth vale até a desinstalação; o do app personalizado vale 24
 *   horas. Renovar é repetir a troca de credenciais, e quem repete é este
 *   arquivo — sob demanda, no momento de usar;
 *
 *   o webhook do OAuth é assinado com o `SHOPIFY_API_SECRET` da Storefy; o do
 *   app personalizado, com o Client Secret daquele app. Um segredo por loja.
 *
 * POR QUE RENOVAR SOB DEMANDA, E NÃO POR UM JOB: o token só serve para
 * chamadas que NÓS fazemos — buscar produto, registrar webhook, conferir
 * estoque. Se ninguém chama, ninguém precisa do token, e um job renovando
 * token de loja parada gastaria chamada à toa. Renovando no ponto de uso, o
 * token está sempre fresco exatamente quando importa, e uma loja que ficou
 * um mês sem uso volta a funcionar na primeira chamada.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { criptografar, descriptografar } from '@/lib/cripto';
import { precisaRenovar, trocarCredenciaisPorToken } from '@/lib/shopify-credenciais';
import { log } from '@/lib/log';

type Client = SupabaseClient<Database>;

/** As colunas da conexão. Uma lista só, para as duas leituras não divergirem. */
const COLUNAS =
  'id, shop_domain, shopify_access_token_enc, shopify_conexao, shopify_client_id, shopify_client_secret_enc, shopify_token_expires_at';

export type TokenDaLoja =
  | { ok: true; token: string; dominio: string }
  /** Motivo em pt-BR. `reconectar` diz que tentar de novo não adianta. */
  | { ok: false; motivo: string; reconectar: boolean };

/**
 * O token de acesso desta loja, renovado se estiver perto de vencer.
 *
 * `servico` é o client da SERVICE ROLE: as colunas `_enc` são invisíveis para
 * o client da sessão por `grant` de coluna, e essa é a proteção que não se
 * contorna "só desta vez".
 */
export async function tokenDaLoja(
  servico: Client,
  storeId: string,
  buscador: typeof fetch = fetch,
): Promise<TokenDaLoja> {
  const { data: loja, error } = await servico
    .from('stores')
    .select(COLUNAS)
    .eq('id', storeId)
    .maybeSingle();

  // Banco fora do ar não é "loja não encontrada": tentar de novo resolve.
  if (error != null) {
    log.erro('shopify-conexao.loja-nao-lida', { falha: error });
    return {
      ok: false,
      motivo: 'Não foi possível ler a conexão com a Shopify agora. Tente de novo.',
      reconectar: false,
    };
  }
  if (loja == null) {
    return { ok: false, motivo: 'Loja não encontrada.', reconectar: false };
  }

  const dominio = loja.shop_domain ?? '';
  const cifrado = loja.shopify_access_token_enc;

  if (cifrado == null || cifrado === '' || dominio === '') {
    return {
      ok: false,
      motivo: 'Conecte a Shopify para usar este recurso.',
      reconectar: true,
    };
  }

  if (!precisaRenovar(loja.shopify_token_expires_at)) {
    const token = abrir(cifrado);
    return token == null
      ? { ok: false, motivo: MOTIVO_ILEGIVEL, reconectar: true }
      : { ok: true, token, dominio };
  }

  return await renovar(
    servico,
    loja.id,
    dominio,
    loja.shopify_client_id,
    loja.shopify_client_secret_enc,
    buscador,
  );
}

const MOTIVO_ILEGIVEL = 'Não conseguimos ler a conexão com a Shopify. Reconecte a loja.';

/**
 * Renova o token da conexão manual e grava o novo.
 *
 * O token novo é gravado ANTES de ser devolvido: se a gravação falhar, a
 * próxima chamada renova de novo — custa uma chamada — enquanto devolver sem
 * gravar faria toda chamada renovar para sempre, e a Shopify limita isso.
 */
async function renovar(
  servico: Client,
  storeId: string,
  dominio: string,
  clientId: string | null,
  segredoCifrado: string | null,
  buscador: typeof fetch,
): Promise<TokenDaLoja> {
  if (clientId == null || clientId === '' || segredoCifrado == null || segredoCifrado === '') {
    /*
     * Token com prazo e sem credencial para renovar: a linha só pode ter sido
     * feita à mão, porque o banco recusa `manual` sem as duas colunas. Não há
     * o que fazer além de pedir a reconexão.
     */
    return {
      ok: false,
      motivo: 'A conexão com a Shopify expirou. Reconecte a loja.',
      reconectar: true,
    };
  }

  const segredo = abrir(segredoCifrado);
  if (segredo == null) return { ok: false, motivo: MOTIVO_ILEGIVEL, reconectar: true };

  const troca = await trocarCredenciaisPorToken(dominio, clientId, segredo, buscador);
  if (!troca.ok) {
    // A Shopify fora do ar não é credencial recusada: reconectar não mudaria nada.
    return { ok: false, motivo: troca.motivo, reconectar: troca.transitoria !== true };
  }

  const { error: erroDaGravacao } = await servico
    .from('stores')
    .update({
      shopify_access_token_enc: criptografar(troca.valor.token),
      shopify_token_expires_at: troca.valor.venceEm,
      // Os escopos podem ter mudado desde a última renovação: o lojista pode
      // ter editado as permissões do app dele no meio do caminho, e a tela
      // precisa mostrar o que vale agora.
      shopify_scopes: troca.valor.escopos,
    })
    .eq('id', storeId);
  /*
   * O token novo vale para esta chamada; sem gravá-lo, a próxima troca de
   * novo. Nada quebra para o lojista, mas a falha precisa aparecer.
   */
  if (erroDaGravacao != null) {
    log.erro('shopify-conexao.token-nao-gravado', { loja: storeId, falha: erroDaGravacao });
  }

  return { ok: true, token: troca.valor.token, dominio };
}

/**
 * O segredo que assina os webhooks DESTA loja.
 *
 * A busca é pelo domínio porque é o que o webhook traz. O `null` cobre dois
 * casos de propósito — loja que não existe e loja sem conexão —, e cobre os
 * dois do MESMO jeito: responder diferente para cada um transformaria esta
 * rota num jeito de descobrir quais lojas são clientes da Storefy.
 */
export async function segredoDoWebhook(servico: Client, shop: string): Promise<string | null> {
  /*
   * Só a loja CONECTADA responde pelo domínio — e ela é uma só, pelo índice
   * único da migration 30. Sem o filtro, qualquer cadastro com o mesmo
   * domínio (desconectado, ou posto ali por outra organização) fazia o
   * `maybeSingle` ver duas linhas e falhar: a rota respondia 503 a todo
   * webhook da loja de verdade, e a Shopify acabava desativando os webhooks
   * dela (migration 58).
   */
  const { data: loja, error } = await servico
    .from('stores')
    .select('shopify_conexao, shopify_client_secret_enc')
    .eq('shop_domain', shop)
    .not('shopify_access_token_enc', 'is', null)
    .maybeSingle();

  /*
   * Sem ler a loja, `null` (503: a Shopify reentrega). Cair no segredo da
   * Storefy recusaria, até o banco voltar, todo webhook de loja conectada pelo
   * app do próprio lojista — que assina com o segredo dela.
   */
  if (error != null) {
    log.erro('shopify-conexao.segredo-nao-lido', { falha: error });
    return null;
  }

  /*
   * Loja desconhecida cai no segredo da Storefy, e não em `null`. Ela existe:
   * é a loja que ACABOU de instalar o app público e ainda não tem linha aqui,
   * ou a que desinstalou e cujo `app/uninstalled` é justamente o webhook que
   * está chegando. Negar os dois quebraria a instalação e a desinstalação.
   */
  if (loja?.shopify_conexao !== 'manual') return segredoDaStorefy();

  /*
   * Daqui para baixo NÃO existe volta ao segredo da Storefy. Esta loja assina
   * com o app dela, e cair no nosso segredo aceitaria como boa uma assinatura
   * que ela não produz — o que devolveria a uma chave só o poder de falar por
   * todas as lojas, que é exatamente o que o segredo por loja desfaz.
   *
   * O banco já recusa `manual` sem o segredo, por constraint. Isto aqui é a
   * segunda tranca, para o dia em que alguém mexer na linha por fora.
   */
  const cifrado = loja.shopify_client_secret_enc;
  if (cifrado == null || cifrado === '') return null;

  return abrir(cifrado);
}

function segredoDaStorefy(): string | null {
  const segredo = process.env.SHOPIFY_API_SECRET;
  return segredo == null || segredo === '' ? null : segredo;
}

/**
 * Abre um valor cifrado sem deixar o erro contar o que falhou.
 *
 * A chave trocada e o valor corrompido dão o mesmo `null`: a diferença só
 * interessa ao log, e quem chama reage igual nos dois casos.
 */
function abrir(cifrado: string): string | null {
  try {
    return descriptografar(cifrado);
  } catch {
    return null;
  }
}

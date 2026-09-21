import 'server-only';

/**
 * Conectar a Shopify pelo app personalizado do próprio lojista.
 *
 * A decisão separada de quem a chama, para ser testável sem sessão e sem
 * banco de verdade: o que está em jogo aqui é o segredo do app de um cliente,
 * e cada caminho de erro precisa ser exercitado.
 *
 * A ORDEM DOS PASSOS NÃO É ARBITRÁRIA:
 *
 *   1. troca as credenciais pelo token ANTES de gravar qualquer coisa. Gravar
 *      primeiro deixaria no banco uma conexão que nunca funcionou, e a tela
 *      diria "conectada" para uma loja que não responde;
 *
 *   2. confere os escopos ANTES de gravar. Um app sem `read_orders` conecta
 *      sem erro nenhum e simplesmente nunca traz pedido — o lojista veria a
 *      receita zerada e não teria como saber por quê;
 *
 *   3. grava, e só então registra os webhooks. Se o registro falhar no meio,
 *      a conexão existe e dá para tentar de novo; na ordem inversa, os
 *      webhooks apontariam para uma loja que o painel não conhece.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { criptografar } from '@/lib/cripto';
import { normalizarDominio } from '@/lib/shopify';
import { escoposPedidos, registrarWebhooks } from '@/lib/shopify-servidor';
import { trocarCredenciaisPorToken } from '@/lib/shopify-credenciais';

type Client = SupabaseClient<Database>;

export interface PedidoDeConexao {
  storeId: string;
  dominio: string;
  clientId: string;
  clientSecret: string;
}

export type ResultadoDaConexao =
  | {
      ok: true;
      dominio: string;
      escopos: string[];
      /** Quantos tópicos ficaram de fora. Zero é o normal. */
      webhooksFalhos: number;
    }
  /** Motivo em pt-BR, pronto para a tela. */
  | { ok: false; motivo: string };

/**
 * Conecta a loja e devolve o que a tela precisa dizer.
 *
 * `servico` é o client da SERVICE ROLE. Quem chama já conferiu sessão e papel.
 */
export async function conectarPeloAppDoLojista(
  servico: Client,
  pedido: PedidoDeConexao,
  urlDoWebhook: string,
  buscador: typeof fetch = fetch,
): Promise<ResultadoDaConexao> {
  const dominio = normalizarDominio(pedido.dominio);
  if (dominio === null) {
    return {
      ok: false,
      motivo: 'Use o endereço que termina em .myshopify.com, como minha-loja.myshopify.com.',
    };
  }

  const clientId = pedido.clientId.trim();
  const clientSecret = pedido.clientSecret.trim();

  if (clientId === '' || clientSecret === '') {
    return { ok: false, motivo: 'Cole o Client ID e o Client Secret do app.' };
  }

  /*
   * A mesma loja conectada em dois lugares deixa o webhook sem dono: a rota
   * não saberia com qual segredo conferir a assinatura, e os pedidos cairiam
   * num dos dois apps por sorteio. O banco também recusa, por índice único;
   * conferir aqui existe para a mensagem ser uma frase em vez de um erro de
   * constraint.
   */
  const { data: jaConectada } = await servico
    .from('stores')
    .select('id')
    .eq('shop_domain', dominio)
    .not('shopify_access_token_enc', 'is', null)
    .maybeSingle();

  if (jaConectada != null && jaConectada.id !== pedido.storeId) {
    return {
      ok: false,
      motivo: 'Esta loja da Shopify já está conectada a outra loja do painel. Desconecte-a antes.',
    };
  }

  const troca = await trocarCredenciaisPorToken(dominio, clientId, clientSecret, buscador);
  if (!troca.ok) return { ok: false, motivo: troca.motivo };

  const faltando = escoposFaltando(troca.valor.escopos);
  if (faltando.length > 0) {
    return {
      ok: false,
      motivo: `Faltam permissões no app: ${faltando.join(', ')}. Adicione no painel da Shopify, reinstale o app na loja e tente de novo.`,
    };
  }

  const { error } = await servico
    .from('stores')
    .update({
      shop_domain: dominio,
      shopify_access_token_enc: criptografar(troca.valor.token),
      shopify_client_id: clientId,
      shopify_client_secret_enc: criptografar(clientSecret),
      shopify_token_expires_at: troca.valor.venceEm,
      shopify_scopes: troca.valor.escopos,
      shopify_conexao: 'manual',
    })
    .eq('id', pedido.storeId);

  if (error != null) {
    return { ok: false, motivo: 'Não conseguimos guardar a conexão agora. Tente de novo.' };
  }

  /*
   * Melhor esforço, e de propósito: um tópico que falhou é um aviso a menos,
   * não uma conexão quebrada. A tela diz quantos faltaram, e reconectar tenta
   * todos de novo — a Shopify não duplica tópico com a mesma URL.
   */
  const webhooks = await registrarWebhooks(dominio, troca.valor.token, urlDoWebhook, buscador);

  return {
    ok: true,
    dominio,
    escopos: troca.valor.escopos,
    webhooksFalhos: webhooks.falharam.length,
  };
}

/** Escopos que pedimos e o app do lojista não tem. */
export function escoposFaltando(concedidos: readonly string[]): string[] {
  const tem = new Set(concedidos);
  return escoposPedidos()
    .split(',')
    .map((escopo) => escopo.trim())
    .filter((escopo) => escopo !== '' && !tem.has(escopo));
}

import 'server-only';

/**
 * O cliente da loja pelo e-mail — a ponte do webhook de automação.
 *
 * O Klaviyo e o Omnisend conhecem o cliente pelo E-MAIL; o app o conhece pelo
 * id do cliente na Shopify (o `__st.cid` da página, gravado no aparelho quando
 * ele entra na conta). Quem liga um ao outro é a própria Shopify, pela busca
 * de clientes da Admin API, com a conexão da loja.
 *
 * O e-mail não é guardado em lugar nenhum: entra na busca e sai dela como id.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { tokenDaLoja } from '@/lib/shopify-conexao';
import { consultarAdmin } from '@/lib/shopify-servidor';
import { buscaPeloEmail, idDoCliente } from '@/lib/webhook-de-automacao';

type Client = SupabaseClient<Database>;

const CLIENTES_PELO_EMAIL = `query ClientesPeloEmail($busca: String!) {
  customers(first: 5, query: $busca) {
    nodes { id }
  }
}`;

/**
 * `causa`: `reconectar` é a loja sem conexão ou sem a permissão de ler
 * clientes; `use-o-id`, a Shopify sem liberar dados de cliente para o app da
 * Storefy (quem chama manda o id do cliente no lugar); `tente-de-novo`, o
 * resto — banco ou Shopify fora do ar.
 */
export type ClientesPeloEmail =
  | { ok: true; ids: string[] }
  | { ok: false; motivo: string; causa: 'reconectar' | 'use-o-id' | 'tente-de-novo' };

export async function clientesPeloEmail(
  servico: Client,
  storeId: string,
  email: string,
  buscador: typeof fetch = fetch,
): Promise<ClientesPeloEmail> {
  const conexao = await tokenDaLoja(servico, storeId, buscador);
  if (!conexao.ok) {
    return {
      ok: false,
      motivo: conexao.motivo,
      causa: conexao.reconectar ? 'reconectar' : 'tente-de-novo',
    };
  }

  const resposta = await consultarAdmin(
    conexao.dominio,
    conexao.token,
    CLIENTES_PELO_EMAIL,
    { busca: buscaPeloEmail(email) },
    buscador,
  );
  if (!resposta.ok) {
    switch (resposta.causa) {
      case 'sem-permissao':
        return {
          ok: false,
          motivo:
            'A Shopify recusou a busca de clientes. Reconecte a loja em Integrações para dar a permissão de ler clientes.',
          causa: 'reconectar',
        };
      case 'dados-protegidos':
        return {
          ok: false,
          motivo:
            'A Shopify ainda não liberou a busca de clientes pelo e-mail para a Storefy. Mande o customerId do cliente no lugar do e-mail.',
          causa: 'use-o-id',
        };
      case 'fora-do-ar':
        return {
          ok: false,
          motivo: 'A Shopify não respondeu a busca do cliente. Tente de novo em instantes.',
          causa: 'tente-de-novo',
        };
    }
  }

  const clientes = resposta.dados.customers;
  const nos =
    clientes !== null && typeof clientes === 'object' && 'nodes' in clientes
      ? clientes.nodes
      : null;
  const ids = (Array.isArray(nos) ? nos : [])
    .map((no: unknown) =>
      no !== null && typeof no === 'object' && 'id' in no ? idDoCliente(no.id) : null,
    )
    .filter((id): id is string => id !== null);

  return { ok: true, ids };
}

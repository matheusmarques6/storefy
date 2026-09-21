'use server';

/**
 * Desconectar a Shopify (C14).
 *
 * A ordem importa e não é óbvia: PRIMEIRO apagamos os webhooks na Shopify, com
 * o token que ainda temos, e só DEPOIS apagamos o token daqui. Na ordem
 * inversa, o token já não existiria para apagar os webhooks — e a Shopify
 * continuaria mandando pedido para uma loja que o painel diz estar
 * desconectada.
 *
 * O que a loja já acumulou (pedidos e números) NÃO some. Desconectar é parar
 * de receber, não apagar histórico; quem quer apagar desinstala o app na
 * Shopify, e aí o `shop/redact` faz a limpeza que a lei exige.
 */
import { revalidatePath } from 'next/cache';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { urlDoSite } from '@/lib/env';
import { ehDominioDeLoja } from '@/lib/shopify';
import { apagarWebhooks } from '@/lib/shopify-servidor';
import { tokenDaLoja } from '@/lib/shopify-conexao';
import { conectarPeloAppDoLojista } from '@/lib/conectar-manual';

export interface EstadoDaIntegracao {
  ok?: boolean;
  mensagem?: string;
}

/**
 * Conectar pelo app que o lojista criou na conta Shopify dele.
 *
 * É o caminho que funciona HOJE, sem esperar a revisão do app público da
 * Storefy. Para o lojista a diferença é colar duas credenciais em vez de
 * clicar em "autorizar"; para o resto do produto não há diferença nenhuma —
 * pedido, receita, aviso de envio e "voltou ao estoque" passam pelos mesmos
 * caminhos.
 *
 * O Client Secret entra por aqui e NÃO SAI: ele é cifrado antes de tocar o
 * banco, a coluna é invisível para o painel por `grant` de coluna, e a trilha
 * de auditoria ignora toda coluna `_enc`. Nem o dono da organização lê de
 * volta o que colou.
 */
export async function conectarShopifyManual(
  _anterior: EstadoDaIntegracao,
  dados: FormData,
): Promise<EstadoDaIntegracao> {
  const { lojaAtiva, papel } = await exigirContextoCliente();

  if (lojaAtiva == null) return { mensagem: 'Nenhuma loja selecionada.' };
  if (papel !== 'owner' && papel !== 'admin') {
    return { mensagem: 'Só o proprietário e os administradores conectam a Shopify.' };
  }

  const resultado = await conectarPeloAppDoLojista(
    criarClientServiceRole(),
    {
      storeId: lojaAtiva.id,
      dominio: texto(dados.get('dominio')),
      clientId: texto(dados.get('clientId')),
      clientSecret: texto(dados.get('clientSecret')),
    },
    `${urlDoSite()}/api/webhooks/shopify`,
  );

  if (!resultado.ok) return { mensagem: resultado.motivo };

  revalidatePath('/integracoes');

  return {
    ok: true,
    mensagem:
      resultado.webhooksFalhos === 0
        ? 'Loja conectada. Já estamos recebendo os pedidos dela.'
        : 'Loja conectada, mas a Shopify não aceitou todos os avisos automáticos. Clique em reconectar para tentar os que faltaram.',
  };
}

/** O campo como texto, sem confiar no que o `FormData` devolve. */
function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === 'string' ? valor : '';
}

export async function desconectarShopify(): Promise<EstadoDaIntegracao> {
  const { lojaAtiva, papel } = await exigirContextoCliente();

  if (lojaAtiva == null) {
    return { mensagem: 'Nenhuma loja selecionada.' };
  }
  if (papel !== 'owner' && papel !== 'admin') {
    return { mensagem: 'Só o proprietário e os administradores desconectam a Shopify.' };
  }
  if (lojaAtiva.shopify_scopes == null) {
    return { mensagem: 'Esta loja já está desconectada.' };
  }

  const servico = criarClientServiceRole();

  /*
   * `tokenDaLoja` renova o token se preciso, e é isso que faz a limpeza
   * funcionar numa conexão manual: o token dela vale 24 horas, e desconectar
   * no dia seguinte com o token velho deixaria os webhooks de pé na Shopify —
   * mandando pedido para uma loja que o painel diz estar desconectada.
   */
  const conexao = await tokenDaLoja(servico, lojaAtiva.id);

  if (conexao.ok && ehDominioDeLoja(conexao.dominio)) {
    try {
      await apagarWebhooks(conexao.dominio, conexao.token, `${urlDoSite()}/api/webhooks/shopify`);
    } catch {
      /*
       * Melhor esforço: o token pode já ter sido revogado por uma
       * desinstalação na própria Shopify, e nesse caso não há webhook nosso de
       * pé. Parar aqui deixaria o lojista preso a uma conexão que ele pediu
       * para encerrar.
       */
      console.warn('[shopify] não foi possível apagar os webhooks de', conexao.dominio);
    }
  }

  /*
   * TODAS as colunas da conexão saem juntas. Deixar o Client Secret para trás
   * guardaria o segredo do app de um cliente que pediu para desconectar — e
   * ninguém olharia de novo para essa linha.
   */
  const { error } = await servico
    .from('stores')
    .update({
      shopify_access_token_enc: null,
      shopify_scopes: null,
      shopify_conexao: null,
      shopify_client_id: null,
      shopify_client_secret_enc: null,
      shopify_token_expires_at: null,
    })
    .eq('id', lojaAtiva.id);

  if (error != null) {
    return { mensagem: 'Não conseguimos desconectar agora. Tente de novo.' };
  }

  revalidatePath('/integracoes');
  return { ok: true, mensagem: 'Loja desconectada da Shopify.' };
}

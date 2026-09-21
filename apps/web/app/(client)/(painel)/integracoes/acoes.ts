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
import { descriptografar } from '@/lib/cripto';
import { urlDoSite } from '@/lib/env';
import { ehDominioDeLoja } from '@/lib/shopify';
import { apagarWebhooks } from '@/lib/shopify-servidor';

export interface EstadoDaIntegracao {
  ok?: boolean;
  mensagem?: string;
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
   * O token é lido pela service role: a coluna `_enc` é invisível para o
   * client da sessão por `grant` de coluna, e essa é justamente a proteção
   * que não se contorna "só desta vez".
   */
  const { data: loja } = await servico
    .from('stores')
    .select('shop_domain, shopify_access_token_enc')
    .eq('id', lojaAtiva.id)
    .maybeSingle();

  const dominio = loja?.shop_domain ?? '';
  const cifrado = loja?.shopify_access_token_enc ?? null;

  if (cifrado != null && cifrado !== '' && ehDominioDeLoja(dominio)) {
    try {
      await apagarWebhooks(
        dominio,
        descriptografar(cifrado),
        `${urlDoSite()}/api/webhooks/shopify`,
      );
    } catch {
      /*
       * Melhor esforço: o token pode já ter sido revogado por uma
       * desinstalação na própria Shopify, e nesse caso não há webhook nosso de
       * pé. Parar aqui deixaria o lojista preso a uma conexão que ele pediu
       * para encerrar.
       */
      console.warn('[shopify] não foi possível apagar os webhooks de', dominio);
    }
  }

  const { error } = await servico
    .from('stores')
    .update({ shopify_access_token_enc: null, shopify_scopes: null })
    .eq('id', lojaAtiva.id);

  if (error != null) {
    return { mensagem: 'Não conseguimos desconectar agora. Tente de novo.' };
  }

  revalidatePath('/integracoes');
  return { ok: true, mensagem: 'Loja desconectada da Shopify.' };
}

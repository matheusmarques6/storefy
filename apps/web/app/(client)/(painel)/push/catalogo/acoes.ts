'use server';

/**
 * A busca de produto e coleção para o composer (C08).
 *
 * Server Action, e não rota: quem chama é um campo de formulário do painel, e
 * a Server Action já vem com a conferência de origem do Next e com a sessão do
 * lojista — que é exatamente o que separa "buscar no catálogo da minha loja"
 * de "buscar no catálogo da loja de qualquer um".
 */
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { buscarNoCatalogo, type ResultadoDaBusca } from '@/lib/catalogo-servidor';

export async function buscarProdutos(termo: string): Promise<ResultadoDaBusca> {
  const { lojaAtiva } = await exigirContextoCliente();

  if (lojaAtiva == null) {
    return { ok: false, motivo: 'Selecione uma loja para buscar no catálogo.' };
  }
  if (!supabaseConfigurado || !serviceRoleConfigurada) {
    return { ok: false, motivo: 'Busca indisponível agora. Tente de novo em instantes.' };
  }

  /*
   * O termo vem do que o lojista digitou. Ele é usado como PARÂMETRO de query
   * na chamada à Shopify — `URLSearchParams` escapa —, e o teto existe para
   * uma colagem gigante não virar uma URL de dezenas de milhares de bytes.
   */
  const limpo = termo.trim().slice(0, 100);

  return await buscarNoCatalogo(criarClientServiceRole(), lojaAtiva.id, limpo);
}

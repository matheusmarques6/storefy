/**
 * `POST /api/webhooks/shopify` — uma rota para todos os tópicos.
 *
 * Uma só, e não sete, porque a conferência de assinatura é o lugar onde um
 * erro custa caro: sete rotas seriam sete chances de esquecer que a assinatura
 * do webhook é BASE64 sobre o corpo CRU. A Shopify diz qual tópico é no
 * cabeçalho.
 *
 * OS TRÊS WEBHOOKS DE PRIVACIDADE SÃO OBRIGATÓRIOS: sem eles a Shopify recusa
 * o app na revisão. Eles não são formalidade — `shop/redact` chega 48 horas
 * depois de uma desinstalação e manda apagar os dados daquela loja.
 *
 * A RESPOSTA É SEMPRE RÁPIDA. A Shopify desiste em 5 segundos e reentrega; um
 * processamento demorado aqui vira o mesmo evento chegando de novo.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import {
  CABECALHO_DA_ASSINATURA,
  CABECALHO_DA_LOJA,
  CABECALHO_DO_TOPICO,
  ehDominioDeLoja,
  ehTopicoConhecido,
} from '@/lib/shopify';
import { conferirHmacDoWebhook } from '@/lib/shopify-assinatura';
import { aplicarWebhook } from '@/lib/shopify-webhook';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' } as const;

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  // Texto cru, uma vez só: `json()` consumiria o corpo e a assinatura deixaria
  // de poder ser conferida.
  const texto = await requisicao.text();

  const segredo = process.env.SHOPIFY_API_SECRET ?? '';
  if (segredo === '') {
    // 503 e não 200: a Shopify reentrega quando o ambiente voltar.
    return NextResponse.json({ erro: 'nao_configurado' }, { status: 503, headers: SEM_CACHE });
  }

  if (!conferirHmacDoWebhook(requisicao.headers.get(CABECALHO_DA_ASSINATURA), segredo, texto)) {
    console.warn('[webhook-shopify] assinatura não confere');
    return NextResponse.json({ erro: 'nao_autorizado' }, { status: 401, headers: SEM_CACHE });
  }

  const topico = (requisicao.headers.get(CABECALHO_DO_TOPICO) ?? '').trim();
  const shop = (requisicao.headers.get(CABECALHO_DA_LOJA) ?? '').trim().toLowerCase();

  if (!ehDominioDeLoja(shop)) {
    return NextResponse.json({ erro: 'loja_invalida' }, { status: 400, headers: SEM_CACHE });
  }

  /*
   * Tópico que não conhecemos vira 200 sem processar. 200 porque a mensagem
   * chegou inteira e a Shopify não tem o que reentregar — e porque uma cadeia
   * de 4xx faz a Shopify DESATIVAR o webhook da loja depois de alguns dias.
   */
  if (!ehTopicoConhecido(topico)) {
    return NextResponse.json({ ok: true, ignorado: topico }, { headers: SEM_CACHE });
  }

  if (!supabaseConfigurado || !serviceRoleConfigurada) {
    return NextResponse.json(
      { erro: 'servidor_nao_configurado' },
      { status: 503, headers: SEM_CACHE },
    );
  }

  try {
    const resultado = await aplicarWebhook(criarClientServiceRole(), topico, shop, texto);
    return NextResponse.json({ ok: true, ...resultado }, { headers: SEM_CACHE });
  } catch (erro) {
    console.error(
      '[webhook-shopify] falhou:',
      topico,
      erro instanceof Error ? erro.message : 'desconhecido',
    );
    // 500 para a Shopify reentregar: um pedido perdido é receita não atribuída.
    return NextResponse.json({ erro: 'indisponivel' }, { status: 500, headers: SEM_CACHE });
  }
}

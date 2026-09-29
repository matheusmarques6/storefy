/**
 * `POST /api/webhooks/automacao` — o push que vem de outra ferramenta (C09, C14).
 *
 * Um fluxo do Klaviyo, uma automação do Omnisend, um nó do n8n chamam este
 * endereço com a chave da automação "Klaviyo, Omnisend e outras ferramentas"
 * e dizem QUEM recebe: o id do cliente na Shopify ou o e-mail. A Storefy acha
 * os aparelhos desse cliente e agenda o push — com o texto do chamado, ou o da
 * automação.
 *
 * As respostas falam com quem configura a ferramenta, e por isso dizem o que
 * fazer: chave errada (401), automação desligada no painel (403), cliente
 * que não dá para achar pelo e-mail — loja sem a Shopify conectada, ou a
 * Shopify sem liberar dados de cliente (422). Cliente sem o app não é erro:
 * 202 com `aparelhos: 0` — ele só não instalou, ou não entrou na conta.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { normalizarDeepLink } from '@/lib/campanha';
import { clientesPeloEmail } from '@/lib/clientes-da-shopify';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { log } from '@/lib/log';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import {
  CorpoDoWebhook,
  TAMANHO_MAXIMO_DO_CORPO,
  chaveDoPedido,
  clientesDoCorpo,
  hashDaChave,
} from '@/lib/webhook-de-automacao';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' } as const;
/** Por automação: um fluxo grande do Klaviyo manda muitos de uma vez. */
const POR_CHAVE_POR_MINUTO = 600;

function responder(status: number, corpo: Record<string, unknown>): NextResponse {
  return NextResponse.json(corpo, { status, headers: SEM_CACHE });
}

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const chave = chaveDoPedido(
    requisicao.headers.get('authorization'),
    requisicao.nextUrl.searchParams.get('token'),
  );
  if (chave === null) {
    return responder(401, {
      erro: 'chave_invalida',
      mensagem: 'Mande a chave da automação no cabeçalho Authorization: Bearer <chave>.',
    });
  }
  if (!supabaseConfigurado || !serviceRoleConfigurada) {
    return responder(503, { erro: 'servidor_nao_configurado' });
  }

  // O tamanho declarado recusa antes de ler; o lido confere quem não declarou.
  const declarado = Number(requisicao.headers.get('content-length') ?? '0');
  if (declarado > TAMANHO_MAXIMO_DO_CORPO) return responder(413, { erro: 'corpo_grande_demais' });
  const texto = await requisicao.text().catch(() => '');
  if (texto.length > TAMANHO_MAXIMO_DO_CORPO) {
    return responder(413, { erro: 'corpo_grande_demais' });
  }
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return responder(400, { erro: 'corpo_invalido', mensagem: 'O corpo precisa ser JSON.' });
  }
  const lido = CorpoDoWebhook.safeParse(bruto);
  if (!lido.success) {
    return responder(400, {
      erro: 'corpo_invalido',
      campos: [...new Set(lido.error.issues.map((problema) => problema.path.join('.')))],
      mensagem: lido.error.issues[0]?.message ?? 'Corpo fora do formato.',
    });
  }
  const corpo = lido.data;
  const hash = hashDaChave(chave);

  try {
    const servico = criarClientServiceRole();

    const lidos = await servico.rpc('ler_webhook_de_automacao', { p_token_hash: hash });
    if (lidos.error != null) throw new Error(lidos.error.message);
    const achado = lidos.data[0];
    // Colunas de função vêm anuláveis no tipo gerado: nula é chave que não vale.
    const webhook =
      achado?.automacao != null && achado.store_id != null && achado.primary_url != null
        ? {
            automacao: achado.automacao,
            storeId: achado.store_id,
            urlDaLoja: achado.primary_url,
            ligada: achado.ligada === true,
          }
        : null;
    if (webhook === null) {
      log.aviso('webhook-automacao.chave-desconhecida');
      return responder(401, {
        erro: 'chave_invalida',
        mensagem: 'Esta chave não vale mais. Gere outra no painel da Storefy.',
      });
    }

    /*
     * O teto é da automação, contado DEPOIS de achar a chave: contado antes,
     * cada chave inventada por quem varre a rota viraria uma linha no banco.
     */
    const teto = await servico.rpc('consumir_limite', {
      p_chave: `webhook-automacao:${webhook.automacao}`,
      p_maximo: POR_CHAVE_POR_MINUTO,
    });
    if (teto.error != null) throw new Error(teto.error.message);
    if (!teto.data) return responder(429, { erro: 'limite', mensagem: 'Muitos avisos seguidos.' });

    const link = normalizarDeepLink(corpo.deepLink, webhook.urlDaLoja);
    if (!link.ok) {
      return responder(400, {
        erro: 'corpo_invalido',
        campos: ['deepLink'],
        mensagem: link.mensagem,
      });
    }

    /*
     * Desligada, a chegada ainda é anotada (o "último aviso recebido" da tela
     * é o que mostra ao lojista que a ferramenta ESTÁ chamando), mas sem
     * procurar cliente nenhum — nem gastar a busca na Shopify.
     */
    let clientes = webhook.ligada ? clientesDoCorpo(corpo) : [];
    if (webhook.ligada && clientes.length === 0 && corpo.email !== undefined) {
      const achados = await clientesPeloEmail(servico, webhook.storeId, corpo.email);
      if (!achados.ok) {
        switch (achados.causa) {
          case 'reconectar':
            return responder(422, { erro: 'shopify_desconectada', mensagem: achados.motivo });
          case 'use-o-id':
            return responder(422, {
              erro: 'busca_por_email_indisponivel',
              mensagem: achados.motivo,
            });
          case 'tente-de-novo':
            return responder(503, { erro: 'shopify_indisponivel', mensagem: achados.motivo });
        }
      }
      clientes = achados.ids;
    }

    const agendados = await servico.rpc('agendar_pelo_webhook', {
      p_automacao: webhook.automacao,
      p_clientes: clientes,
      ...(corpo.title === undefined ? {} : { p_titulo: corpo.title }),
      ...(corpo.body === undefined ? {} : { p_corpo: corpo.body }),
      ...(link.caminho === null ? {} : { p_link: link.caminho }),
      ...(corpo.id === undefined ? {} : { p_ref: String(corpo.id) }),
    });
    if (agendados.error != null) throw new Error(agendados.error.message);

    if (!webhook.ligada) {
      return responder(403, {
        erro: 'automacao_desligada',
        mensagem:
          'A automação está desligada. Ligue em Notificações › Automações, no painel da Storefy.',
      });
    }
    return responder(202, { recebido: true, aparelhos: agendados.data });
  } catch (erro) {
    log.erro('webhook-automacao.falhou', { erro });
    return responder(503, { erro: 'indisponivel', mensagem: 'Tente de novo em instantes.' });
  }
}

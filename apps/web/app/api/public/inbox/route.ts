/**
 * `POST /api/public/inbox` — a caixa de avisos do app (M07 do plano).
 *
 * Mesma autenticação dos outros dois endpoints públicos. É POST, e não GET,
 * porque a assinatura é sobre o corpo: um GET assinado teria de pôr os dados
 * na URL, e URL entra em log de proxy, de CDN e de servidor.
 *
 * A função do banco decide o que este aparelho pode ver — e o que ele NÃO
 * pode, que é o que importa: campanha de antes da instalação e campanha com
 * segmento ficam de fora.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { buscarSegredoCifrado } from '@/lib/segredo-do-app';
import {
  CABECALHO_DA_ASSINATURA,
  CABECALHOS,
  CorpoDaCaixa,
  autorizar,
  lerCaixaDeAvisos,
  type Resposta,
} from '@/lib/endpoint-do-app';

export const dynamic = 'force-dynamic';

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const resposta = await decidir(requisicao);
  if (resposta.motivo != null) {
    console.warn('[inbox] recusado:', resposta.motivo);
  }
  return NextResponse.json(resposta.corpo, {
    status: resposta.status,
    headers: CABECALHOS,
  });
}

async function decidir(requisicao: NextRequest): Promise<Resposta> {
  if (!supabaseConfigurado || !serviceRoleConfigurada) {
    return {
      status: 503,
      corpo: { erro: 'servidor_nao_configurado' },
      motivo: 'Supabase ou service role ausente',
    };
  }

  const corpoBruto = await requisicao.text();
  const autorizacao = await autorizar(
    CorpoDaCaixa,
    corpoBruto,
    requisicao.headers.get(CABECALHO_DA_ASSINATURA),
    buscarSegredoCifrado,
    Date.now(),
  );
  if (!autorizacao.ok) return autorizacao.resposta;

  try {
    const supabase = criarClientServiceRole();
    const { data, error } = await supabase.rpc('caixa_de_avisos', {
      p_app_id: autorizacao.dados.appId,
      p_subscription: autorizacao.dados.subscriptionId,
    });

    if (error != null) {
      return { status: 503, corpo: { erro: 'indisponivel' }, motivo: error.message };
    }
    return lerCaixaDeAvisos(data);
  } catch (erro) {
    return {
      status: 503,
      corpo: { erro: 'indisponivel' },
      motivo: erro instanceof Error ? erro.message : 'falha desconhecida',
    };
  }
}

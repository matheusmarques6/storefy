/**
 * `POST /api/public/push-opened` — o cliente tocou numa notificação de
 * automação (C09, C10 e C11).
 *
 * As aberturas de uma campanha vêm da OneSignal; as de uma automação não
 * podem vir de lá, porque cada envio é uma notificação própria. Então o app
 * avisa: o despachante põe o id do envio nos dados da notificação, e o toque
 * chega aqui assinado com o segredo do app, como as outras rotas que ele
 * escreve. A função do Postgres conta uma vez só.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { buscarSegredoCifrado } from '@/lib/segredo-do-app';
import {
  CABECALHO_DA_ASSINATURA,
  CABECALHOS,
  CorpoDaAbertura,
  autorizar,
  respostaDaAbertura,
  type Resposta,
} from '@/lib/endpoint-do-app';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const resposta = await decidir(requisicao);
  if (resposta.motivo != null) {
    // Só no nosso log. O corpo da resposta nunca explica a recusa.
    log.aviso('app-abertura.recusado', { motivo: resposta.motivo });
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
    CorpoDaAbertura,
    corpoBruto,
    requisicao.headers.get(CABECALHO_DA_ASSINATURA),
    buscarSegredoCifrado,
    Date.now(),
  );
  if (!autorizacao.ok) return autorizacao.resposta;

  try {
    const supabase = criarClientServiceRole();
    const { data, error } = await supabase.rpc('registrar_abertura_do_envio', {
      p_app_id: autorizacao.dados.appId,
      p_envio: autorizacao.dados.envio,
    });

    if (error != null) {
      return { status: 503, corpo: { erro: 'indisponivel' }, motivo: error.message };
    }
    return respostaDaAbertura(data);
  } catch (erro) {
    // Nada escapa como a página de erro do Next, em HTML: o app não saberia ler.
    return {
      status: 503,
      corpo: { erro: 'indisponivel' },
      motivo: erro instanceof Error ? erro.message : 'falha desconhecida',
    };
  }
}

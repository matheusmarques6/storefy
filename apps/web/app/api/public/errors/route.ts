/**
 * `POST /api/public/errors` — os erros do app, a caminho do Sentry (Fase 8).
 *
 * Um erro de JavaScript no app acontece no celular de um cliente de loja,
 * longe de qualquer log. O app o manda aqui, assinado como tudo que ele manda,
 * e daqui ele segue para o Sentry com a plataforma, a versão e o app — o
 * suficiente para saber se é um app ou todos, e a partir de qual versão.
 *
 * SEM `SENTRY_DSN`, 202 sem fazer nada: não há para onde mandar, e o app não
 * precisa saber disso. Há um teto por app e por hora, para um erro em laço num
 * aparelho não virar uma avalanche na cota do Sentry.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { buscarSegredoCifrado } from '@/lib/segredo-do-app';
import {
  CABECALHO_DA_ASSINATURA,
  CABECALHOS,
  CorpoDoErroDoApp,
  autorizar,
  type Resposta,
} from '@/lib/endpoint-do-app';
import { log } from '@/lib/log';
import { relatarErro, sentryConfigurado } from '@/lib/sentry';

export const dynamic = 'force-dynamic';

const POR_APP_POR_HORA = 100;

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const resposta = await decidir(requisicao);
  if (resposta.motivo != null) log.aviso('app-erros.recusado', { motivo: resposta.motivo });
  return NextResponse.json(resposta.corpo, { status: resposta.status, headers: CABECALHOS });
}

async function decidir(requisicao: NextRequest): Promise<Resposta> {
  if (!sentryConfigurado()) return { status: 202, corpo: { recebido: false } };
  if (!supabaseConfigurado || !serviceRoleConfigurada) {
    return {
      status: 503,
      corpo: { erro: 'servidor_nao_configurado' },
      motivo: 'Supabase ou service role ausente',
    };
  }

  const corpoBruto = await requisicao.text();
  const autorizacao = await autorizar(
    CorpoDoErroDoApp,
    corpoBruto,
    requisicao.headers.get(CABECALHO_DA_ASSINATURA),
    buscarSegredoCifrado,
    Date.now(),
  );
  if (!autorizacao.ok) return autorizacao.resposta;

  const { appId, tipo, mensagem, pilha, fatal, platform, appVersion } = autorizacao.dados;

  const { data: cabe, error: falhaDoTeto } = await criarClientServiceRole().rpc('consumir_limite', {
    p_chave: `app-erros:${appId}`,
    p_maximo: POR_APP_POR_HORA,
    p_janela_segundos: 3600,
  });
  // Sem o teto não há como segurar um erro em laço: melhor não mandar.
  if (falhaDoTeto != null) {
    log.erro('app-erros.teto-indisponivel', { falha: falhaDoTeto });
    return { status: 503, corpo: { erro: 'indisponivel' } };
  }
  if (!cabe) return { status: 429, corpo: { erro: 'limite' }, motivo: 'teto por app' };

  const erro = new Error(mensagem);
  erro.name = tipo;
  // A pilha é a do app, e não a desta rota.
  erro.stack = pilha ?? `${tipo}: ${mensagem}`;

  await relatarErro({
    erro,
    origem: 'app',
    nivel: fatal ? 'error' : 'warning',
    marcas: {
      app: appId,
      plataforma: platform,
      ...(appVersion === undefined ? {} : { versao: appVersion }),
      fatal: String(fatal),
    },
  });
  return { status: 202, corpo: { recebido: true } };
}

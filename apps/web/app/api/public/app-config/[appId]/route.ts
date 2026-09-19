/**
 * `GET /api/public/app-config/[appId]` — a config publicada de um app.
 *
 * Público de propósito: quem consome é o app do lojista, instalado no celular
 * do cliente final, sem sessão nenhuma. O conteúdo já viaja dentro do binário
 * publicado nas lojas de aplicativos, então não há aqui nada que já não seja
 * público — e nada de `*_enc`, token ou chave passa nem perto.
 *
 * A service role é usada porque não existe usuário: a RLS de `app_configs` fala
 * de membros de organização, e não há membro nenhum do outro lado. Em troca, a
 * consulta é a mais estreita possível — uma tabela, duas colunas, filtrada por
 * `status = 'published'`. Rascunho nunca sai daqui.
 *
 * A decisão de o que responder está em `lib/app-config-publica.ts`, com testes.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { ehUuid, montarResposta, type LinhaPublicada } from '@/lib/app-config-publica';

// O cache é do CDN, pelo Cache-Control. O Next não deve prerender isto.
export const dynamic = 'force-dynamic';

/** A config é pública; liberar a origem deixa o preview do painel lê-la. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'If-None-Match, Accept',
  'Access-Control-Expose-Headers': 'ETag',
} as const;

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  requisicao: NextRequest,
  contexto: { params: Promise<{ appId: string }> },
): Promise<NextResponse> {
  const { appId } = await contexto.params;
  const ifNoneMatch = requisicao.headers.get('if-none-match');

  const servidorPronto = supabaseConfigurado && serviceRoleConfigurada;

  let linha: LinhaPublicada | null = null;
  let falhaNoBanco = false;

  // Só consulta o banco depois de o id passar: um GET com lixo na URL não
  // merece uma ida ao Postgres, e são justamente esses que chegam em volume.
  if (servidorPronto && ehUuid(appId)) {
    try {
      const supabase = criarClientServiceRole();
      const { data, error } = await supabase
        .from('app_configs')
        .select('config, version')
        .eq('app_id', appId)
        .eq('status', 'published')
        .maybeSingle();

      if (error != null) falhaNoBanco = true;
      else if (data != null) linha = { config: data.config, version: data.version };
    } catch {
      /*
       * Nada pode escapar daqui. O que sai desta rota é o que o app de todo
       * cliente recebe; uma exceção viraria a página de erro do Next, em HTML,
       * e o app trataria como config inválida sem nenhuma pista do motivo.
       */
      falhaNoBanco = true;
    }
  }

  const resposta = montarResposta({
    appId,
    ifNoneMatch,
    servidorPronto,
    linha,
    falhaNoBanco,
  });

  const cabecalhos = { ...CORS, ...resposta.cabecalhos };

  if (resposta.corpo === null) {
    return new NextResponse(null, { status: resposta.status, headers: cabecalhos });
  }
  return NextResponse.json(resposta.corpo, { status: resposta.status, headers: cabecalhos });
}

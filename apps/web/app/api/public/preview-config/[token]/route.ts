/**
 * `GET /api/public/preview-config/[token]` — o rascunho, para o app de prévia.
 *
 * O app Storefy Preview não tem sessão do painel: quem o autoriza é o código
 * que o lojista gerou no editor e leu pelo QR. O código vale minutos, é
 * guardado como hash e some quando vence.
 *
 * A service role é usada porque não existe usuário do outro lado — e, como no
 * endpoint da config publicada, a consulta é a mais estreita possível.
 */
import { NextResponse } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { ehTokenDePrevia, hashDoToken, montarRespostaDaPrevia } from '@/lib/previa-publica';

export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept',
} as const;

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  _requisicao: Request,
  contexto: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await contexto.params;
  const servidorPronto = supabaseConfigurado && serviceRoleConfigurada;

  let config: unknown = null;
  let falhaNoBanco = false;

  if (servidorPronto && ehTokenDePrevia(token)) {
    try {
      const supabase = criarClientServiceRole();

      const { data: sessao, error: erroSessao } = await supabase
        .from('preview_sessions')
        .select('app_id')
        .eq('token_hash', hashDoToken(token))
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (erroSessao != null) falhaNoBanco = true;
      else if (sessao != null) {
        const { data: rascunho, error: erroRascunho } = await supabase
          .from('app_configs')
          .select('config')
          .eq('app_id', sessao.app_id)
          .eq('status', 'draft')
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (erroRascunho != null) falhaNoBanco = true;
        else if (rascunho != null) config = rascunho.config;
      }
    } catch {
      // Nada escapa: o app trataria uma página de erro em HTML como config
      // inválida, sem nenhuma pista do motivo.
      falhaNoBanco = true;
    }
  }

  const resposta = montarRespostaDaPrevia({ token, servidorPronto, config, falhaNoBanco });
  const cabecalhos = { ...CORS, ...resposta.cabecalhos };

  if (resposta.corpo === null) {
    return new NextResponse(null, { status: resposta.status, headers: cabecalhos });
  }
  return NextResponse.json(resposta.corpo, { status: resposta.status, headers: cabecalhos });
}

/**
 * `POST /api/webhooks/eas` — o EAS avisa que o build terminou.
 *
 * Quem chama é o Expo, não o nosso workflow: o `eas build --no-wait` devolve na
 * hora e o binário fica sendo gerado por mais 15 a 30 minutos, já sem nenhum
 * processo nosso esperando. É este webhook que fecha a linha de `builds`.
 *
 * Três decisões que valem a leitura:
 *
 *   o corpo é lido como TEXTO e a assinatura é conferida sobre esse texto,
 *   antes de qualquer `JSON.parse`. Reserializar mudaria um espaço e a
 *   assinatura pararia de bater;
 *   a busca é por `eas_build_id`, que só quem criou o build conhece;
 *   o update exige que o build esteja em "na fila" ou "gerando". O EAS
 *   reentrega webhook que falhou, e sem essa trava uma reentrega tardia
 *   reescreveria como "gerado" um app que a Apple já tinha aprovado.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import {
  CABECALHO_DA_ASSINATURA,
  CorpoDoEas,
  conferirAssinaturaDoEas,
  montarAtualizacao,
  traduzirStatus,
} from '@/lib/eas-webhook';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' } as const;

/** Status a partir dos quais o webhook ainda pode mexer na linha. */
const ABERTOS = ['queued', 'building'] as const;

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  // Texto cru, uma vez só: `requisicao.json()` consumiria o corpo e a
  // assinatura deixaria de poder ser conferida.
  const texto = await requisicao.text();

  const conferencia = conferirAssinaturaDoEas(
    requisicao.headers.get(CABECALHO_DA_ASSINATURA),
    process.env.EAS_WEBHOOK_SECRET,
    texto,
  );
  if (!conferencia.ok) {
    console.warn('[webhook-eas] recusado:', conferencia.motivo);
    return NextResponse.json(
      { erro: 'nao_autorizado' },
      { status: conferencia.status, headers: SEM_CACHE },
    );
  }

  if (!supabaseConfigurado || !serviceRoleConfigurada) {
    // 503 e não 200: assim o EAS reentrega quando o ambiente voltar.
    return NextResponse.json(
      { erro: 'servidor_nao_configurado' },
      { status: 503, headers: SEM_CACHE },
    );
  }

  const analise = CorpoDoEas.safeParse(interpretar(texto));
  if (!analise.success) {
    return NextResponse.json({ erro: 'corpo_invalido' }, { status: 400, headers: SEM_CACHE });
  }

  const corpo = analise.data;
  const status = traduzirStatus(corpo.status);

  /*
   * Status que não conhecemos vira 200 sem escrita. 200 porque o EAS não tem o
   * que reentregar — a mensagem chegou inteira e foi entendida; o que não dá é
   * para traduzir um status novo deles num status nosso sem chutar.
   */
  if (status === null) {
    return NextResponse.json({ ok: true, ignorado: corpo.status }, { headers: SEM_CACHE });
  }

  try {
    const servico = criarClientServiceRole();

    const { data: linhas, error } = await servico
      .from('builds')
      .update(montarAtualizacao(corpo, status, new Date().toISOString()))
      .eq('eas_build_id', corpo.id)
      .in('status', ABERTOS)
      .select('id');

    if (error != null) {
      console.error('[webhook-eas] falhou:', error.message);
      return NextResponse.json({ erro: 'indisponivel' }, { status: 503, headers: SEM_CACHE });
    }

    /*
     * Zero linhas tem duas causas, e elas pedem respostas diferentes:
     *
     *   o build existe mas já passou de "gerando" — reentrega repetida. 200,
     *   para o EAS parar de tentar;
     *   nenhum build nosso tem esse id — o webhook pode ter chegado antes de o
     *   workflow gravar o `eas_build_id`. 404, para o EAS reentregar.
     */
    if (linhas.length === 0) {
      const { count } = await servico
        .from('builds')
        .select('id', { count: 'exact', head: true })
        .eq('eas_build_id', corpo.id);

      if ((count ?? 0) > 0) {
        return NextResponse.json({ ok: true, ignorado: 'ja_concluido' }, { headers: SEM_CACHE });
      }

      console.warn('[webhook-eas] build desconhecido no EAS:', corpo.id);
      return NextResponse.json(
        { erro: 'build_nao_encontrado' },
        { status: 404, headers: SEM_CACHE },
      );
    }
  } catch (erroDoBanco) {
    console.error(
      '[webhook-eas] falhou:',
      erroDoBanco instanceof Error ? erroDoBanco.message : 'desconhecido',
    );
    return NextResponse.json({ erro: 'indisponivel' }, { status: 503, headers: SEM_CACHE });
  }

  return NextResponse.json({ ok: true }, { headers: SEM_CACHE });
}

/** JSON inválido vira `null`, que o Zod recusa com um 400 limpo. */
function interpretar(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

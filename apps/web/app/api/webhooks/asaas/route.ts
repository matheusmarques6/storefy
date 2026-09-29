/**
 * `POST /api/webhooks/asaas` — a Asaas avisa que uma fatura mudou (criada,
 * paga, vencida, estornada, removida) ou que uma assinatura acabou.
 *
 * Quatro decisões que valem a leitura:
 *
 *   o segredo é o `asaas-access-token` que a própria Asaas manda em cada aviso
 *   (o "token de autenticação" configurado no webhook, lá no painel dela),
 *   comparado em tempo constante;
 *   a empresa sai da ASSINATURA do aviso, que só a Storefy criou — o resto da
 *   conta na Asaas é ignorado e anotado como tal;
 *   cada aviso vale uma vez: o banco anota o id na mesma transação que aplica,
 *   e o reenvio de um aviso já aplicado não muda nada;
 *   erro nosso responde 500, e a Asaas reenvia. Aviso que não é para nós
 *   responde 200 — senão ela pausa a fila de todos os avisos por causa dele.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { tokenDoWebhook } from '@/lib/asaas';
import { interpretarAviso } from '@/lib/cobranca';
import { iguaisEmTempoConstante } from '@/lib/cripto';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' } as const;

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const token = tokenDoWebhook();
  if (token === null) {
    log.erro('webhook-asaas.sem-token-configurado');
    // 503 e não 200: a Asaas guarda e reenvia quando o token existir.
    return NextResponse.json(
      { erro: 'webhook_nao_configurado' },
      { status: 503, headers: SEM_CACHE },
    );
  }

  const recebido = requisicao.headers.get('asaas-access-token') ?? '';
  if (!iguaisEmTempoConstante(recebido, token)) {
    log.aviso('webhook-asaas.token-recusado');
    return NextResponse.json({ erro: 'nao_autorizado' }, { status: 401, headers: SEM_CACHE });
  }

  if (!supabaseConfigurado || !serviceRoleConfigurada) {
    return NextResponse.json(
      { erro: 'servidor_nao_configurado' },
      { status: 503, headers: SEM_CACHE },
    );
  }

  let corpo: unknown;
  try {
    corpo = await requisicao.json();
  } catch {
    return NextResponse.json({ erro: 'corpo_invalido' }, { status: 400, headers: SEM_CACHE });
  }

  const aviso = interpretarAviso(corpo);
  if (aviso.tipo === 'ignorado') {
    return NextResponse.json({ ok: true, ignorado: aviso.motivo }, { headers: SEM_CACHE });
  }

  const supabase = criarClientServiceRole();
  const { data: resultado, error } =
    aviso.tipo === 'fatura'
      ? await supabase.rpc('registrar_fatura', {
          p_provider: 'asaas',
          p_evento: aviso.evento,
          p_tipo: aviso.nome,
          p_fatura: aviso.fatura,
          p_assinatura: aviso.assinatura,
          p_valor_centavos: aviso.valorCentavos,
          p_status: aviso.situacao,
          p_vencimento: aviso.vencimento,
          ...(aviso.pagaEm === null ? {} : { p_paga_em: aviso.pagaEm }),
          ...(aviso.link === null ? {} : { p_link: aviso.link }),
        })
      : await supabase.rpc('encerrar_assinatura', {
          p_provider: 'asaas',
          p_assinatura: aviso.assinatura,
          p_evento: aviso.evento,
          p_tipo: aviso.nome,
        });

  if (error != null) {
    log.erro('webhook-asaas.falhou', { aviso: aviso.nome, falha: error });
    return NextResponse.json({ erro: 'falhou' }, { status: 500, headers: SEM_CACHE });
  }

  return NextResponse.json({ ok: true, resultado }, { headers: SEM_CACHE });
}

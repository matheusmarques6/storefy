/**
 * `GET /api/jobs/push-stats` — entregas e aberturas das campanhas.
 *
 * O Vercel Cron chama a cada 15 minutos. Os números da OneSignal demoram a
 * estabilizar, e consultar a cada minuto gastaria a cota da API de cada loja
 * sem mudar nada na tela.
 *
 * De carona, apaga as imagens de push que nenhuma campanha usa há um dia
 * (formulário abandonado, imagem trocada, campanha excluída): sem isso o
 * bucket só cresce, com fotos de promoções que nunca saíram.
 *
 * O que não vier da OneSignal simplesmente não é gravado. A tela mostra traço
 * para o que ainda não sabe, e um zero gravado aqui viraria "a campanha não
 * abriu" na leitura do lojista (regra 1 do CLAUDE.md).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criptografiaConfigurada, descriptografar } from '@/lib/cripto';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { CABECALHO_DO_CRON, autorizarJob, registrarBatimento } from '@/lib/jobs';
import { buscarEstatisticas } from '@/lib/onesignal';
import { BUCKET_DO_PUSH } from '@/lib/imagem-do-push';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(requisicao: NextRequest): Promise<NextResponse> {
  const autorizacao = autorizarJob(
    requisicao.headers.get(CABECALHO_DO_CRON),
    process.env.CRON_SECRET,
  );
  if (!autorizacao.ok) {
    log.aviso('job-estatisticas.recusado', { motivo: autorizacao.motivo });
    return NextResponse.json(
      { erro: 'nao_autorizado' },
      { status: autorizacao.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!supabaseConfigurado || !serviceRoleConfigurada || !criptografiaConfigurada()) {
    return NextResponse.json(
      { erro: 'servidor_nao_configurado' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let consultadas = 0;
  let atualizadas = 0;
  let imagensApagadas = 0;
  const inicio = Date.now();

  try {
    const supabase = criarClientServiceRole();
    const { data: campanhas, error } = await supabase.rpc('campanhas_para_estatistica', {
      p_limite: 50,
    });
    if (error != null) throw new Error(error.message);

    for (const campanha of campanhas) {
      if (campanha.id === null || campanha.onesignal_notification_id === null) continue;
      if (campanha.onesignal_app_id === null || campanha.onesignal_api_key_enc === null) continue;

      consultadas += 1;

      let chave: string;
      try {
        chave = descriptografar(campanha.onesignal_api_key_enc);
      } catch {
        // A chave de uma loja não abrir não pode parar as estatísticas das
        // outras. O envio é que vai marcar isso como falha, com motivo.
        continue;
      }

      const numeros = await buscarEstatisticas(
        { appId: campanha.onesignal_app_id, chave },
        campanha.onesignal_notification_id,
      );
      if (numeros === null) continue;

      // Só grava o que veio de verdade. Chave ausente é diferente de zero.
      const stats: Record<string, number> = {};
      if (numeros.enviados !== null) stats.enviados = numeros.enviados;
      if (numeros.entregues !== null) stats.entregues = numeros.entregues;
      if (numeros.abertos !== null) stats.abertos = numeros.abertos;
      if (numeros.falhas !== null) stats.falhas = numeros.falhas;
      if (Object.keys(stats).length === 0) continue;

      await supabase.rpc('gravar_estatistica', { p_id: campanha.id, p_stats: stats });
      atualizadas += 1;
    }

    // As estatísticas acima já estão gravadas: uma falha daqui para baixo
    // aparece no batimento do job sem desfazer nada delas.
    const { data: orfas, error: erroDasOrfas } = await supabase.rpc(
      'imagens_de_push_sem_campanha',
      { p_limite: 200 },
    );
    if (erroDasOrfas != null) throw new Error(erroDasOrfas.message);
    const caminhos = orfas.flatMap((orfa) => (orfa.caminho === null ? [] : [orfa.caminho]));
    if (caminhos.length > 0) {
      const { error: erroDaLimpeza } = await supabase.storage.from(BUCKET_DO_PUSH).remove(caminhos);
      if (erroDaLimpeza != null) throw new Error(erroDaLimpeza.message);
      imagensApagadas = caminhos.length;
    }
  } catch (erro) {
    log.erro('job-estatisticas.falhou', { erro });
    await registrarBatimento('push-stats', inicio, erro);
    return NextResponse.json(
      { erro: 'falhou', consultadas, atualizadas, imagensApagadas },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  log.info('job-estatisticas.concluido', { consultadas, atualizadas, imagensApagadas });
  await registrarBatimento('push-stats', inicio);
  return NextResponse.json(
    { consultadas, atualizadas, imagensApagadas },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

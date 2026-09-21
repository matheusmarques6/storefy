/**
 * `POST /api/internal/ota` — o que o workflow de correção OTA precisa saber.
 *
 * Duas perguntas, uma rota, porque o workflow faz as duas em momentos
 * diferentes e nenhuma delas devolve credencial de loja de aplicativos:
 *
 *   `etapa: 'lista'` — quais lojas recebem a correção. A resposta vira uma
 *   matriz de jobs no GitHub, cujos nomes ficam visíveis para quem lê as
 *   execuções, então ela não leva segredo nenhum;
 *   `etapa: 'loja'` — as variáveis do pacote DAQUELA loja, incluindo o segredo
 *   com que o app assina o que manda.
 *
 * A separação é o ponto: se a lista já trouxesse os segredos, o segredo de
 * cada loja apareceria no log de montagem da matriz.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criptografiaConfigurada, descriptografar } from '@/lib/cripto';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import {
  CABECALHO_DO_SEGREDO,
  abrirOuNulo,
  autorizarWorkflow,
  slugDoProjeto,
} from '@/lib/build-interno';
import { canalDaOta } from '@/lib/ota';

export const dynamic = 'force-dynamic';

const SEM_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

const Corpo = z.discriminatedUnion('etapa', [
  z.object({ etapa: z.literal('lista'), otaId: z.uuid() }),
  z.object({ etapa: z.literal('loja'), otaId: z.uuid(), storeId: z.uuid() }),
]);

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const autorizacao = autorizarWorkflow(
    requisicao.headers.get(CABECALHO_DO_SEGREDO),
    process.env.BUILD_API_SECRET,
  );
  if (!autorizacao.ok) {
    console.warn('[ota-interno] recusado:', autorizacao.motivo);
    return NextResponse.json(
      { erro: 'nao_autorizado' },
      { status: autorizacao.status, headers: SEM_CACHE },
    );
  }

  if (!supabaseConfigurado || !serviceRoleConfigurada || !criptografiaConfigurada()) {
    return NextResponse.json(
      { erro: 'servidor_nao_configurado' },
      { status: 503, headers: SEM_CACHE },
    );
  }

  const analise = Corpo.safeParse(await requisicao.json().catch(() => null));
  if (!analise.success) {
    return NextResponse.json({ erro: 'corpo_invalido' }, { status: 400, headers: SEM_CACHE });
  }

  try {
    const servico = criarClientServiceRole();

    // A rodada precisa existir e ainda estar aberta: um otaId antigo, que
    // apareceu num log de execução, não serve para buscar segredo nenhum.
    const { data: rodada } = await servico
      .from('ota_updates')
      .select('id, status')
      .eq('id', analise.data.otaId)
      .in('status', ['queued', 'running'])
      .maybeSingle();

    if (rodada == null) {
      return NextResponse.json(
        { erro: 'rodada_nao_encontrada' },
        { status: 404, headers: SEM_CACHE },
      );
    }

    if (analise.data.etapa === 'lista') {
      const { data: lojas, error } = await servico.rpc('lojas_para_ota');
      if (error != null) throw new Error(error.message);

      const lista = lojas
        .filter((loja) => loja.store_id !== null)
        .map((loja) => ({
          storeId: loja.store_id,
          canal: canalDaOta(loja.store_id ?? ''),
        }));

      // O total fica gravado aqui, e não no fim: é ele que o admin usa para
      // mostrar "3 de 12" enquanto a matriz roda.
      await servico
        .from('ota_updates')
        .update({ total: lista.length, status: 'running', started_at: new Date().toISOString() })
        .eq('id', rodada.id)
        .eq('status', 'queued');

      return NextResponse.json({ lojas: lista }, { headers: SEM_CACHE });
    }

    const { data: dados, error } = await servico.rpc('dados_da_ota', {
      p_store_id: analise.data.storeId,
    });
    if (error != null) throw new Error(error.message);

    const loja = dados[0];
    if (loja?.app_id == null || loja.store_id == null) {
      return NextResponse.json(
        { erro: 'loja_nao_encontrada' },
        { status: 404, headers: SEM_CACHE },
      );
    }

    return NextResponse.json(
      {
        storeId: loja.store_id,
        appId: loja.app_id,
        nomeDoApp: loja.nome_do_app,
        bundleIdIos: loja.bundle_id_ios,
        packageAndroid: loja.package_android,
        expoProjectId: loja.expo_project_id,
        slug: slugDoProjeto(loja.store_id),
        oneSignalAppId: loja.onesignal_app_id,
        deviceSecret: abrirOuNulo(loja.device_secret_enc, descriptografar),
        canal: canalDaOta(loja.store_id),
      },
      { headers: SEM_CACHE },
    );
  } catch (erro) {
    // A mensagem vai para o NOSSO log: um erro do Postgres pode carregar o
    // valor de uma coluna, e esta rota lida com a coluna do segredo do app.
    console.error('[ota-interno] falhou:', erro instanceof Error ? erro.message : 'desconhecido');
    return NextResponse.json({ erro: 'indisponivel' }, { status: 503, headers: SEM_CACHE });
  }
}

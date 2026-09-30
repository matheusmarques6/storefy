/** Correção OTA para todas as lojas (A-OTA). */
import type { Metadata } from 'next';
import { RefreshCw } from 'lucide-react';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import Link from 'next/link';
import { paradaDaRodada, resumoDaOta } from '@/lib/ota';
import { FUSO_PADRAO, formatarDataHora } from '@/lib/fuso';
import { EstadoVazio } from '@/components/estado-vazio';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { BotaoEncerrarRodada } from './botao-encerrar';
import { FormularioDaOta } from './formulario';
import { lido } from '@/lib/leitura';

export const metadata: Metadata = { title: 'Correção OTA' };

/** Quantas lojas com falha cada rodada nomeia; o resto vira "e mais N". */
const LOJAS_COM_FALHA_NOMEADAS = 5;
export const dynamic = 'force-dynamic';

const ROTULO = {
  queued: 'Na fila',
  running: 'Publicando',
  finished: 'Publicada',
  errored: 'Com falha',
} as const;

const COR = {
  queued: 'outline',
  running: 'secondary',
  finished: 'default',
  errored: 'destructive',
} as const;

export default async function PaginaDaOta() {
  await exigirPlatformAdmin();

  /*
   * Service role porque `ota_updates` é leitura só para `platform_admins`, e
   * a checagem acima já foi feita no banco. A RLS continua valendo para quem
   * chegar por outro caminho.
   */
  const servico = criarClientServiceRole();
  const { data: rodadas } = lido(
    await servico
      .from('ota_updates')
      .select(
        'id, status, message, total, concluidas, falhas, lojas_com_falha, error, created_at, updated_at, finished_at',
      )
      .order('created_at', { ascending: false })
      .limit(20),
    'as rodadas de correção',
  );

  const lista = (rodadas ?? []).map((rodada) => ({
    ...rodada,
    parada: paradaDaRodada({
      status: rodada.status,
      criadaEm: rodada.created_at,
      atualizadaEm: rodada.updated_at,
    }),
  }));
  const aberta = lista.find((rodada) => rodada.status === 'queued' || rodada.status === 'running');
  const bloqueio = aberta === undefined ? null : aberta.parada === null ? 'andamento' : 'parada';

  /*
   * Os nomes das lojas em que a correção falhou: "com 3 falhas" sem dizer
   * onde manda a equipe caçar no GitHub. Poucas por rodada, para a consulta
   * não crescer com uma rodada que falhou em todas.
   */
  const idsComFalha = [
    ...new Set(
      lista.flatMap((rodada) => rodada.lojas_com_falha.slice(0, LOJAS_COM_FALHA_NOMEADAS)),
    ),
  ];
  const { data: lojasComFalha } =
    idsComFalha.length === 0
      ? { data: [] }
      : lido(
          await servico.from('stores').select('id, name, org_id').in('id', idsComFalha),
          'as lojas com falha',
        );
  const lojaPorId = new Map((lojasComFalha ?? []).map((loja) => [loja.id, loja]));

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Correção OTA</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Publica o JavaScript atual deste repositório no app de todas as lojas. Elas recebem na
          próxima abertura, sem build novo e sem passar pela revisão da Apple.
        </p>
      </div>

      <FormularioDaOta bloqueio={bloqueio} />

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Histórico</h2>

        {lista.length === 0 ? (
          <EstadoVazio
            icone={RefreshCw}
            titulo="Nenhuma correção publicada"
            descricao="Quando você publicar uma correção, cada rodada aparece aqui com o andamento por loja."
          />
        ) : (
          <Card>
            <ul className="divide-y">
              {lista.map((rodada) => (
                <li key={rodada.id} className="space-y-1 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{rodada.message}</span>
                    <Badge variant={COR[rodada.status]}>{ROTULO[rodada.status]}</Badge>
                    {rodada.parada === null ? null : (
                      <>
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                          Parada · {rodada.parada}
                        </span>
                        <BotaoEncerrarRodada otaId={rodada.id} />
                      </>
                    )}
                  </div>

                  <p className="text-muted-foreground text-sm">
                    {resumoDaOta(rodada.status, {
                      total: rodada.total,
                      concluidas: rodada.concluidas,
                      falhas: rodada.falhas,
                    })}
                  </p>

                  {rodada.lojas_com_falha.length === 0 ? null : (
                    <LojasComFalha ids={rodada.lojas_com_falha} lojaPorId={lojaPorId} />
                  )}

                  {rodada.error === null ? null : (
                    <p className="text-destructive text-sm break-words">{rodada.error}</p>
                  )}

                  <p className="text-muted-foreground text-xs">
                    <time dateTime={rodada.created_at}>{formatar(rodada.created_at)}</time>
                    {rodada.finished_at === null
                      ? null
                      : ` · terminou ${formatar(rodada.finished_at)}`}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function formatar(iso: string): string {
  return formatarDataHora(iso, FUSO_PADRAO);
}

/**
 * "Falhou em: Loja A, Loja B e mais 3." Cada nome leva ao cliente (A04); a
 * loja excluída depois da rodada conta no "mais", sem nome.
 */
function LojasComFalha({
  ids,
  lojaPorId,
}: {
  ids: readonly string[];
  lojaPorId: ReadonlyMap<string, { id: string; name: string; org_id: string }>;
}) {
  const nomeadas = ids
    .slice(0, LOJAS_COM_FALHA_NOMEADAS)
    .map((id) => lojaPorId.get(id))
    .filter((loja) => loja !== undefined);
  const resto = ids.length - nomeadas.length;

  return (
    <p className="text-muted-foreground text-sm">
      Falhou em:{' '}
      {nomeadas.map((loja, indice) => (
        <span key={loja.id}>
          {indice > 0 ? ', ' : null}
          <Link
            href={`/admin/organizacoes/${loja.org_id}`}
            className="text-foreground underline-offset-4 hover:underline"
          >
            {loja.name}
          </Link>
        </span>
      ))}
      {resto > 0
        ? `${nomeadas.length > 0 ? ' e mais ' : ''}${String(resto)} ${resto === 1 ? 'loja' : 'lojas'}`
        : null}
      .
    </p>
  );
}

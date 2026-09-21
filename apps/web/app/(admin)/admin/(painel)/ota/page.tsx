/** Correção OTA para todas as lojas (A-OTA). */
import type { Metadata } from 'next';
import { RefreshCw } from 'lucide-react';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { resumoDaOta } from '@/lib/ota';
import { EstadoVazio } from '@/components/estado-vazio';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FormularioDaOta } from './formulario';

export const metadata: Metadata = { title: 'Correção OTA' };
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
  const { data: rodadas } = await servico
    .from('ota_updates')
    .select('id, status, message, total, concluidas, falhas, error, created_at, finished_at')
    .order('created_at', { ascending: false })
    .limit(20);

  const lista = rodadas ?? [];
  const emAndamento = lista.some(
    (rodada) => rodada.status === 'queued' || rodada.status === 'running',
  );

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Correção OTA</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Publica o JavaScript atual deste repositório no app de todas as lojas. Elas recebem na
          próxima abertura, sem build novo e sem passar pela revisão da Apple.
        </p>
      </div>

      <FormularioDaOta bloqueado={emAndamento} />

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
                  </div>

                  <p className="text-muted-foreground text-sm">
                    {resumoDaOta(rodada.status, {
                      total: rodada.total,
                      concluidas: rodada.concluidas,
                      falhas: rodada.falhas,
                    })}
                  </p>

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
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

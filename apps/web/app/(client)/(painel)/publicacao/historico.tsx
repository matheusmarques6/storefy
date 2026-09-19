/**
 * O histórico de builds (parte da C12).
 *
 * Mostra o que já foi enviado e onde cada um parou. Quando um build falha, o
 * motivo aparece aqui — é a diferença entre o lojista entender e abrir um
 * chamado perguntando "o que aconteceu".
 */
import { History } from 'lucide-react';
import type { BuildNaLista } from '@/lib/publicacao-servidor';
import type { Database } from '@storefy/db';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EstadoVazio } from '@/components/estado-vazio';

type Status = Database['public']['Enums']['build_status'];

const ROTULO: Record<Status, string> = {
  queued: 'Na fila',
  building: 'Gerando',
  finished: 'Gerado',
  errored: 'Falhou',
  submitted: 'Enviado para a loja',
  in_review: 'Em revisão',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  canceled: 'Cancelado',
};

const EXPLICACAO: Record<Status, string> = {
  queued: 'Esperando a vez. Costuma começar em poucos minutos.',
  building: 'Gerando o binário. Leva de 15 a 30 minutos.',
  finished: 'Binário pronto, indo para a loja.',
  errored: 'Não foi possível gerar o binário.',
  submitted: 'A loja recebeu. Agora é aguardar a revisão.',
  in_review: 'Alguém da loja está analisando o app.',
  approved: 'Aprovado. O app já está disponível.',
  rejected: 'A loja recusou. Veja o motivo e corrija.',
  canceled: 'Interrompido antes de terminar.',
};

const COR: Record<Status, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'outline',
  building: 'secondary',
  finished: 'secondary',
  errored: 'destructive',
  submitted: 'secondary',
  in_review: 'secondary',
  approved: 'default',
  rejected: 'destructive',
  canceled: 'outline',
};

export function HistoricoDeBuilds({ builds }: { builds: readonly BuildNaLista[] }) {
  if (builds.length === 0) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Histórico</h2>
        <EstadoVazio
          icone={History}
          titulo="Nenhuma publicação ainda"
          descricao="Quando você publicar, cada envio aparece aqui com o andamento e o resultado."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Histórico</h2>
      <Card>
        <ul className="divide-y">
          {builds.map((build) => (
            <li key={build.id} className="flex flex-wrap items-start gap-3 p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {build.platform === 'ios' ? 'App Store' : 'Play Store'}
                  </span>
                  <Badge variant={COR[build.status]}>{ROTULO[build.status]}</Badge>
                  {build.version === null ? null : (
                    <span className="text-muted-foreground text-xs">
                      versão {build.version}
                      {build.buildNumber === null ? '' : ` (${String(build.buildNumber)})`}
                    </span>
                  )}
                </div>

                <p className="text-muted-foreground text-sm">{EXPLICACAO[build.status]}</p>

                {/*
                  O motivo do erro fica na tela, e não só no log. É a diferença
                  entre o lojista entender e abrir um chamado perguntando "o
                  que aconteceu".
                */}
                {build.error === null ? null : (
                  <p className="text-destructive text-sm break-words">{build.error}</p>
                )}

                <p className="text-muted-foreground text-xs">
                  <time dateTime={build.createdAt}>{formatar(build.createdAt)}</time>
                  {build.finishedAt === null ? null : ` · terminou ${formatar(build.finishedAt)}`}
                </p>
              </div>

              {build.logsUrl === null ? null : (
                <a
                  href={build.logsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-muted-foreground hover:text-foreground shrink-0 text-sm underline underline-offset-2"
                >
                  Ver detalhes
                </a>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function formatar(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

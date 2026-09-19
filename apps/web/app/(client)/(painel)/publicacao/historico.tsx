/**
 * O histórico de builds (parte da C12).
 *
 * Mostra o que já foi enviado e onde cada um parou. Quando um build falha, o
 * motivo aparece aqui — é a diferença entre o lojista entender e abrir um
 * chamado perguntando "o que aconteceu".
 */
import { Download, History } from 'lucide-react';
import type { BuildNaLista } from '@/lib/publicacao-servidor';
import type { Database } from '@storefy/db';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EstadoVazio } from '@/components/estado-vazio';
import { PassoManual } from './passo-manual';

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

/**
 * A explicação de uma linha, que depende de ONDE parou — não só do status.
 *
 * Um build com passo manual falhou no ENVIO, e não na geração: o binário
 * existe e está logo ali, para baixar. Dizer "não foi possível gerar o
 * binário" ao lado de um card que diz "o app está pronto" faz o lojista achar
 * que a tela está quebrada, e é exatamente o que aparecia antes desta função.
 */
export function explicacaoDoBuild(build: BuildNaLista): string {
  if (build.status === 'errored' && build.acaoManual !== null) {
    return 'O app foi gerado, mas não chegou à loja. Veja abaixo como enviá-lo.';
  }
  return EXPLICACAO[build.status];
}

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

                <p className="text-muted-foreground text-sm">{explicacaoDoBuild(build)}</p>

                {/*
                  O motivo do erro fica na tela, e não só no log. É a diferença
                  entre o lojista entender e abrir um chamado perguntando "o
                  que aconteceu".
                */}
                {build.error === null ? null : (
                  <p className="text-destructive text-sm break-words">{build.error}</p>
                )}

                {/*
                  Quando existe um passo manual, ele vem com o passo a passo e o
                  arquivo: um "falhou" sem saída faria o lojista abrir chamado.
                */}
                {build.acaoManual === null ? null : (
                  <PassoManual
                    acao={build.acaoManual}
                    plataforma={build.platform}
                    artifactUrl={build.artifactUrl}
                  />
                )}

                <p className="text-muted-foreground text-xs">
                  <time dateTime={build.createdAt}>{formatar(build.createdAt)}</time>
                  {build.finishedAt === null ? null : ` · terminou ${formatar(build.finishedAt)}`}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-3">
                {/*
                  O arquivo fica à mão mesmo quando deu tudo certo: o lojista
                  pode querer guardá-lo. Quando há passo manual, o botão de
                  baixar já aparece dentro dele — aqui seria repetição.
                */}
                {build.artifactUrl === null || build.acaoManual !== null ? null : (
                  <a
                    href={build.artifactUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm underline underline-offset-2"
                  >
                    <Download className="size-3.5" aria-hidden />
                    Baixar
                  </a>
                )}

                {build.logsUrl === null ? null : (
                  <a
                    href={build.logsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-2"
                  >
                    Ver detalhes
                  </a>
                )}
              </div>
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

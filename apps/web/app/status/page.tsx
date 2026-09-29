/**
 * A página pública de status (Fase 8).
 *
 * Responde a pergunta que chega ao suporte quando algo atrasa — "a campanha
 * não saiu, é comigo ou com vocês?" — com o batimento de verdade de cada
 * rotina, e não com um "tudo certo" fixo. Pública, sem login e fora do proxy:
 * precisa abrir justamente quando algo vai mal. Não mostra nada de cliente nem
 * o texto dos erros — isso a equipe vê na A13.
 */
import type { Metadata } from 'next';
import { CheckCircle2, CircleAlert, Clock, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatarDataHora } from '@/lib/fuso';
import { ROTULO_DO_ESTADO, type EstadoDoComponente } from '@/lib/status';
import { lerStatus } from '@/lib/status-servidor';
import { AtualizarSozinho } from './atualizar-sozinho';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Status',
  description: 'Como estão o painel, o envio de notificações e as rotinas do Storefy agora.',
};

const VARIANTE: Record<EstadoDoComponente, 'success' | 'warning' | 'destructive' | 'outline'> = {
  operacional: 'success',
  instavel: 'warning',
  parado: 'destructive',
  aguardando: 'outline',
};

const ICONE: Record<EstadoDoComponente, typeof CheckCircle2> = {
  operacional: CheckCircle2,
  instavel: TriangleAlert,
  parado: CircleAlert,
  aguardando: Clock,
};

export default async function PaginaDeStatus() {
  const status = await lerStatus();
  const Icone = ICONE[status.resumo.estado];

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <AtualizarSozinho segundos={60} />
      <h1 className="text-2xl font-semibold tracking-tight">Status do Storefy</h1>

      <div
        role="status"
        className="bg-card mt-6 flex items-center gap-3 rounded-2xl border p-4 text-sm font-medium"
      >
        <Icone
          className={
            status.resumo.estado === 'operacional'
              ? 'size-5 text-emerald-600'
              : status.resumo.estado === 'parado'
                ? 'text-destructive size-5'
                : 'size-5 text-amber-600'
          }
          aria-hidden
        />
        {status.resumo.frase}
      </div>

      <ul className="mt-6 divide-y rounded-2xl border">
        {status.componentes.map((componente) => (
          <li key={componente.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">{componente.nome}</p>
              <p className="text-muted-foreground text-sm">{componente.descricao}</p>
              <p className="text-muted-foreground text-xs">{componente.detalhe}</p>
            </div>
            <Badge variant={VARIANTE[componente.estado]} className="shrink-0">
              {ROTULO_DO_ESTADO[componente.estado]}
            </Badge>
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground mt-6 text-xs">
        Conferido em {formatarDataHora(status.verificadoEm, 'America/Sao_Paulo')} (horário de
        Brasília). A página se atualiza sozinha a cada minuto.
      </p>
    </main>
  );
}

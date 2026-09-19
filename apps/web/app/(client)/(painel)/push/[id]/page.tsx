/** Detalhe de uma campanha (C10): o que foi enviado e o que aconteceu. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { appDaLoja, buscarCampanha } from '@/lib/push-servidor';
import {
  EXPLICACAO_DO_STATUS,
  ROTULO_DO_STATUS,
  lerMetricas,
  numeroOuTraco,
  podeEditar,
  porcentagemOuTraco,
} from '@/lib/campanha';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PreviaDaNotificacao } from '../previa-da-notificacao';

export const metadata: Metadata = { title: 'Campanha' };

export default async function PaginaDaCampanha({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lojaAtiva, papel } = await exigirContextoCliente();
  if (lojaAtiva == null) notFound();

  const supabase = await criarClientServidor();
  const app = await appDaLoja(supabase, lojaAtiva.id);
  if (app == null) notFound();

  const campanha = await buscarCampanha(supabase, app.id, id);
  if (campanha == null) notFound();

  const metricas = lerMetricas(campanha.stats);
  const semEstatistica = metricas.entregues === null && metricas.abertos === null;
  const podeEscrever = papel === 'owner' || papel === 'admin';

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href="/push"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Notificações
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{campanha.title}</h1>
          <Badge variant={campanha.status === 'failed' ? 'destructive' : 'secondary'}>
            {ROTULO_DO_STATUS[campanha.status]}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">{EXPLICACAO_DO_STATUS[campanha.status]}</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metrica rotulo="Enviados" valor={numeroOuTraco(metricas.enviados)} />
            <Metrica rotulo="Entregues" valor={numeroOuTraco(metricas.entregues)} />
            <Metrica rotulo="Aberturas" valor={numeroOuTraco(metricas.abertos)} />
            <Metrica
              rotulo="Taxa de abertura"
              valor={porcentagemOuTraco(metricas.taxaDeAbertura)}
            />
          </div>

          {/*
            Nada de gráfico com zeros enquanto o número não chega. A regra 1 do
            CLAUDE.md: estado vazio explicando, nunca número inventado.
          */}
          {semEstatistica ? (
            <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
              {campanha.status === 'sent'
                ? 'As estatísticas chegam algumas horas depois do envio. Volte mais tarde.'
                : 'Os números aparecem depois que a campanha for enviada.'}
            </p>
          ) : null}

          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <Linha titulo="Mensagem" valor={campanha.body} />
            <Linha
              titulo="Abre em"
              valor={campanha.deepLink ?? 'Tela inicial do app'}
              icone={campanha.deepLink !== null}
            />
            <Linha titulo="Criada em" valor={formatar(campanha.createdAt)} />
            <Linha
              titulo={campanha.sentAt === null ? 'Agendada para' : 'Enviada em'}
              valor={formatar(campanha.sentAt ?? campanha.scheduledAt)}
            />
          </dl>

          {podeEscrever && podeEditar(campanha.status) ? (
            <Button asChild variant="outline">
              <Link href={`/push/${campanha.id}/editar`}>Editar campanha</Link>
            </Button>
          ) : null}
        </div>

        <aside>
          <PreviaDaNotificacao
            nomeDoApp={lojaAtiva.name}
            title={campanha.title}
            body={campanha.body}
          />
        </aside>
      </div>
    </div>
  );
}

function Metrica({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-muted-foreground text-xs">{rotulo}</p>
        <p className="text-xl font-semibold tabular-nums">{valor}</p>
      </CardContent>
    </Card>
  );
}

function Linha({ titulo, valor, icone }: { titulo: string; valor: string; icone?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{titulo}</dt>
      <dd className="flex items-center gap-1.5 break-words">
        {valor}
        {icone === true ? (
          <ExternalLink className="size-3.5 shrink-0 opacity-50" aria-hidden />
        ) : null}
      </dd>
    </div>
  );
}

function formatar(iso: string | null): string {
  if (iso === null) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
}

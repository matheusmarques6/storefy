/** Detalhe de uma campanha (C10): o que foi enviado e o que aconteceu. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { appDaLoja, buscarCampanha, vendasDasCampanhas } from '@/lib/push-servidor';
import { funilDaCampanha, vendasVisiveis } from '@/lib/vendas-do-push';
import { formatarDataHora } from '@/lib/fuso';
import { EXPLICACAO_DO_STATUS, ROTULO_DO_STATUS, lerMetricas, podeEditar } from '@/lib/campanha';
import { descricaoDoPublico } from '@/lib/publico-do-push';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PreviaDaNotificacao } from '../previa-da-notificacao';
import { FunilDaCampanha } from './funil';

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

  const comVendas = vendasVisiveis(lojaAtiva);
  const enviada = campanha.status === 'sent';
  const vendas =
    comVendas && enviada
      ? (await vendasDasCampanhas(supabase, [campanha.id])).get(campanha.id)
      : undefined;

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

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {/*
            Nada de gráfico com zeros enquanto o número não chega. A regra 1 do
            CLAUDE.md: estado vazio explicando, nunca número inventado.
          */}
          {semEstatistica ? (
            <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
              {enviada
                ? 'As estatísticas chegam algumas horas depois do envio. Volte mais tarde.'
                : 'Os números aparecem depois que a campanha for enviada.'}
            </p>
          ) : null}

          {enviada ? (
            <FunilDaCampanha
              etapas={funilDaCampanha(metricas, vendas, comVendas)}
              vendas={vendas}
              vendasVisiveis={comVendas}
              podeConectar={podeEscrever}
            />
          ) : null}

          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <Linha titulo="Mensagem" valor={campanha.body} />
            <Linha
              titulo="Abre em"
              valor={campanha.deepLink ?? 'Tela inicial do app'}
              icone={campanha.deepLink !== null}
            />
            <Linha titulo="Quem recebe" valor={descricaoDoPublico(campanha.publico)} />
            <Linha titulo="Imagem" valor={campanha.imagem === null ? 'Sem imagem' : 'Com imagem'} />
            <Linha titulo="Criada em" valor={formatar(campanha.createdAt, lojaAtiva.timezone)} />
            <Linha
              titulo={campanha.sentAt === null ? 'Agendada para' : 'Enviada em'}
              valor={formatar(campanha.sentAt ?? campanha.scheduledAt, lojaAtiva.timezone)}
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
            imagem={campanha.imagem?.url ?? null}
          />
        </aside>
      </div>
    </div>
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

function formatar(iso: string | null, fuso: string): string {
  return formatarDataHora(iso, fuso, { dateStyle: 'long', timeStyle: 'short' });
}

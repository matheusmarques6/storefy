/** Editar uma campanha que ainda não saiu (C08, no modo de edição). */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { appDaLoja, buscarCampanha } from '@/lib/push-servidor';
import { podeEditar } from '@/lib/campanha';
import { EstadoVazio } from '@/components/estado-vazio';
import { Button } from '@/components/ui/button';
import { EditarCampanha } from './editar-campanha';

export const metadata: Metadata = { title: 'Editar campanha' };

/** ISO do banco para o formato que o `datetime-local` aceita, no fuso local. */
function paraCampoLocal(iso: string | null): string {
  if (iso === null) return '';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  const local = new Date(data.getTime() - data.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default async function PaginaDeEdicao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lojaAtiva, papel } = await exigirContextoCliente();
  if (lojaAtiva == null) notFound();

  const supabase = await criarClientServidor();
  const app = await appDaLoja(supabase, lojaAtiva.id);
  if (app == null) notFound();

  const campanha = await buscarCampanha(supabase, app.id, id);
  if (campanha == null) notFound();

  if (papel !== 'owner' && papel !== 'admin') {
    return (
      <EstadoVazio
        icone={ChevronLeft}
        titulo="Você não tem permissão para editar campanhas"
        descricao="Apenas proprietários e administradores mexem nas notificações."
        acao={
          <Button asChild variant="outline">
            <Link href="/push">Voltar</Link>
          </Button>
        }
      />
    );
  }

  /*
   * Campanha já enviada não se edita. A tela diz isso em vez de mostrar um
   * formulário que o servidor vai recusar — e o histórico continua sendo o
   * texto que realmente chegou nos celulares.
   */
  if (!podeEditar(campanha.status)) {
    return (
      <EstadoVazio
        icone={ChevronLeft}
        titulo="Esta campanha já saiu"
        descricao="O texto enviado não muda mais. Se quiser corrigir algo, crie uma campanha nova."
        acao={
          <Button asChild variant="outline">
            <Link href={`/push/${campanha.id}`}>Ver a campanha</Link>
          </Button>
        }
      />
    );
  }

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
        <h1 className="text-2xl font-semibold tracking-tight">Editar campanha</h1>
      </div>

      <EditarCampanha
        campanhaId={campanha.id}
        nomeDoApp={lojaAtiva.name}
        urlDaLoja={lojaAtiva.primary_url}
        iniciais={{
          title: campanha.title,
          body: campanha.body,
          deepLink: campanha.deepLink ?? '',
          agendarPara: paraCampoLocal(campanha.scheduledAt),
          enviarAgora: campanha.status === 'draft',
        }}
      />
    </div>
  );
}

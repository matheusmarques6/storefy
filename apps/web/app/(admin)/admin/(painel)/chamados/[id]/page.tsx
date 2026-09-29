/** A14 — a conversa de um chamado, do lado da equipe. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { ROTULO_DA_SITUACAO_PARA_EQUIPE, ROTULO_DO_ASSUNTO } from '@/lib/chamados';
import { FUSO_PADRAO, formatarDataHora } from '@/lib/fuso';
import { MudarSituacao, ResponderComoEquipe } from './responder';
import { ConversaDoChamado } from '@/components/conversa-do-chamado';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { lido } from '@/lib/leitura';
import { log } from '@/lib/log';

export const metadata: Metadata = { title: 'Chamado · Admin' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function PaginaDoChamadoAdmin({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigirPlatformAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await criarClientServidor();

  const { data: chamado } = lido(
    await supabase
      .from('support_tickets')
      .select(
        'id, titulo, assunto, status, created_at, org_id, author_id, organizations(name), stores(name)',
      )
      .eq('id', id)
      .maybeSingle(),
    'o chamado',
  );
  if (chamado == null) notFound();

  const [{ data: mensagens, error }, { data: autor, error: erroDoAutor }] = await Promise.all([
    supabase.rpc('mensagens_do_chamado', { p_ticket_id: chamado.id }),
    chamado.author_id == null
      ? Promise.resolve({ data: null, error: null })
      : supabase.rpc('admin_email_do_usuario', { p_user_id: chamado.author_id }),
  ]);
  if (error != null) throw new Error(`Não foi possível carregar a conversa: ${error.message}`);
  // Sem o e-mail de quem abriu, a conversa ainda abre — e a falha fica no log.
  if (erroDoAutor != null) log.aviso('chamados.autor-nao-lido', { falha: erroDoAutor });

  const fechado = chamado.status === 'fechado';

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/admin/chamados"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Voltar para os chamados
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{chamado.titulo}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            <Link
              href={`/admin/organizacoes/${chamado.org_id}`}
              className="text-foreground underline-offset-4 hover:underline"
            >
              {chamado.organizations.name}
            </Link>
            {chamado.stores == null ? null : ` · ${chamado.stores.name}`}
            {' · '}
            {ROTULO_DO_ASSUNTO[chamado.assunto]}
            {' · aberto por '}
            {typeof autor === 'string' && autor !== '' ? autor : 'conta excluída'}
            {' em '}
            {formatarDataHora(chamado.created_at, FUSO_PADRAO)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={chamado.status === 'aberto' ? 'default' : 'outline'}>
            {ROTULO_DA_SITUACAO_PARA_EQUIPE[chamado.status]}
          </Badge>
          <MudarSituacao ticketId={chamado.id} fechado={fechado} />
        </div>
      </div>

      <ConversaDoChamado
        ladoDaEquipe
        fuso={FUSO_PADRAO}
        mensagens={mensagens.map((mensagem) => ({
          id: mensagem.id ?? '',
          daEquipe: mensagem.da_equipe === true,
          texto: mensagem.texto ?? '',
          autor: mensagem.autor ?? '',
          quando: mensagem.created_at,
        }))}
      />

      <Card>
        <CardContent className="pt-6">
          <ResponderComoEquipe ticketId={chamado.id} />
        </CardContent>
      </Card>
    </div>
  );
}

/** C17 — a conversa de um chamado, do lado do lojista. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { ROTULO_DA_SITUACAO_PARA_LOJISTA, ROTULO_DO_ASSUNTO } from '@/lib/chamados';
import { FUSO_PADRAO } from '@/lib/fuso';
import { FecharChamado, ResponderChamado } from './conversa';
import { ConversaDoChamado } from '@/components/conversa-do-chamado';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { lido } from '@/lib/leitura';

export const metadata: Metadata = { title: 'Chamado · Ajuda' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function PaginaDoChamado({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { organizacao, lojas, lojaAtiva, visita } = await exigirContextoCliente();
  const supabase = await criarClientServidor();

  // O filtro pela empresa ATIVA, além da RLS: o chamado de outra empresa da
  // mesma pessoa abre com aquela empresa selecionada, e não misturado nesta.
  const { data: chamado } = lido(
    await supabase
      .from('support_tickets')
      .select('id, titulo, assunto, status, store_id, created_at')
      .eq('id', id)
      .eq('org_id', organizacao.id)
      .maybeSingle(),
    'o chamado',
  );
  if (chamado == null) notFound();

  const { data: mensagens, error } = await supabase.rpc('mensagens_do_chamado', {
    p_ticket_id: chamado.id,
  });
  if (error != null) throw new Error(`Não foi possível carregar a conversa: ${error.message}`);

  const loja = lojas.find((item) => item.id === chamado.store_id) ?? null;
  const fechado = chamado.status === 'fechado';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/ajuda"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Voltar para a ajuda
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{chamado.titulo}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {ROTULO_DO_ASSUNTO[chamado.assunto]}
            {loja === null ? null : ` · ${loja.name}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={chamado.status === 'respondido' ? 'default' : 'outline'}>
            {ROTULO_DA_SITUACAO_PARA_LOJISTA[chamado.status]}
          </Badge>
          {fechado || visita != null ? null : <FecharChamado ticketId={chamado.id} />}
        </div>
      </div>

      <ConversaDoChamado
        ladoDaEquipe={false}
        fuso={lojaAtiva?.timezone ?? FUSO_PADRAO}
        mensagens={mensagens.map((mensagem) => ({
          id: mensagem.id ?? '',
          daEquipe: mensagem.da_equipe === true,
          texto: mensagem.texto ?? '',
          autor: mensagem.autor ?? '',
          quando: mensagem.created_at,
        }))}
      />

      {visita == null ? (
        <Card>
          <CardContent className="pt-6">
            <ResponderChamado ticketId={chamado.id} fechado={fechado} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

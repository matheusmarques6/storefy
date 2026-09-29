/**
 * A14 — Chamados: o que os lojistas perguntaram, separado por de quem é a vez.
 *
 * Abre em "Esperando resposta" — o cliente escreveu por último e a vez é da
 * equipe. É o número que a Visão geral mostra em "precisa de você".
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import type { TicketStatus } from '@storefy/db';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import {
  DATA_DA_SITUACAO_PARA_EQUIPE,
  ROTULO_DA_SITUACAO_PARA_EQUIPE,
  ROTULO_DO_ASSUNTO,
} from '@/lib/chamados';
import { FUSO_PADRAO, formatarDataHora } from '@/lib/fuso';
import { Paginacao, lerParams } from '../paginacao';
import { Card } from '@/components/ui/card';
import { EstadoVazio } from '@/components/estado-vazio';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Chamados · Admin' };

const RECORTES: readonly TicketStatus[] = ['aberto', 'respondido', 'fechado'];

const VAZIO: Record<TicketStatus, string> = {
  aberto: 'Nenhum cliente esperando resposta.',
  respondido: 'Nenhum chamado esperando o cliente.',
  fechado: 'Nenhum chamado fechado ainda.',
};

export default async function PaginaChamados({
  searchParams,
}: {
  searchParams: Promise<{ situacao?: string; pagina?: string }>;
}) {
  await exigirPlatformAdmin();
  const brutos = await searchParams;
  const situacao = RECORTES.find((item) => item === brutos.situacao) ?? 'aberto';
  const { pagina, de, ate } = lerParams({ pagina: brutos.pagina });
  const supabase = await criarClientServidor();

  const contar = (status: TicketStatus) =>
    supabase
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('status', status);

  const [lista, abertos, respondidos, fechados] = await Promise.all([
    supabase
      .from('support_tickets')
      .select('id, titulo, assunto, updated_at, org_id, organizations(name)', { count: 'exact' })
      .eq('status', situacao)
      .order('updated_at', { ascending: situacao === 'aberto' })
      .range(de, ate),
    contar('aberto'),
    contar('respondido'),
    contar('fechado'),
  ]);
  if (lista.error != null)
    throw new Error(`Não foi possível carregar os chamados: ${lista.error.message}`);

  const contagem: Record<TicketStatus, number> = {
    aberto: abertos.count ?? 0,
    respondido: respondidos.count ?? 0,
    fechado: fechados.count ?? 0,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Chamados</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          O que os lojistas perguntaram pela Ajuda do painel. Os esperando resposta aparecem do mais
          antigo para o mais novo.
        </p>
      </div>

      <nav aria-label="Situação dos chamados" className="flex flex-wrap gap-1">
        {RECORTES.map((item) => (
          <Link
            key={item}
            href={`/admin/chamados?situacao=${item}`}
            aria-current={item === situacao ? 'page' : undefined}
            className={cn(
              'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              item === situacao
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            {ROTULO_DA_SITUACAO_PARA_EQUIPE[item]} ({contagem[item]})
          </Link>
        ))}
      </nav>

      {lista.data.length === 0 ? (
        <EstadoVazio
          icone={MessageCircle}
          titulo={VAZIO[situacao]}
          descricao="Os chamados chegam pela tela Ajuda do painel do cliente."
        />
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chamado</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden sm:table-cell">Assunto</TableHead>
                  <TableHead className="whitespace-nowrap">
                    {DATA_DA_SITUACAO_PARA_EQUIPE[situacao]}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.data.map((chamado) => (
                  <TableRow key={chamado.id}>
                    <TableCell className="min-w-48 font-medium">
                      <Link
                        href={`/admin/chamados/${chamado.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {chamado.titulo}
                      </Link>
                      {/* No celular o assunto vem aqui, e a coluna dele some. */}
                      <span className="text-muted-foreground block text-xs font-normal sm:hidden">
                        {ROTULO_DO_ASSUNTO[chamado.assunto]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/organizacoes/${chamado.org_id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {chamado.organizations.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell">
                      {ROTULO_DO_ASSUNTO[chamado.assunto]}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatarDataHora(chamado.updated_at, FUSO_PADRAO)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Paginacao
            pagina={pagina}
            total={lista.count ?? 0}
            base="/admin/chamados"
            busca=""
            extras={{ situacao }}
          />
        </>
      )}
    </div>
  );
}

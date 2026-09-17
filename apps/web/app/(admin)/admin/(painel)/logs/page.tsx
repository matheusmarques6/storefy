/** A12 — Logs de auditoria. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ScrollText } from 'lucide-react';
import { ROTULO_ACAO_AUDITORIA } from '@storefy/db';
import { criarClientServidor } from '@/lib/supabase/server';
import { CampoBusca, Paginacao, lerParams } from '../paginacao';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EstadoVazio } from '@/components/estado-vazio';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Auditoria · Admin' };

export default async function PaginaLogs({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const { busca, pagina, de, ate } = lerParams(await searchParams);
  const supabase = await criarClientServidor();

  let consulta = supabase
    .from('audit_logs')
    .select('id, action, entity, entity_id, diff, created_at, org_id, organizations(id, name)', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(de, ate);

  if (busca !== '') {
    const termo = busca.replace(/[,()]/g, ' ').trim();
    consulta = consulta.ilike('entity', `%${termo}%`);
  }

  const { data: logs, count, error } = await consulta;
  if (error != null) throw new Error(`Não foi possível carregar a auditoria: ${error.message}`);

  const lista = logs;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auditoria</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Quem fez o quê. Os registros são somente-anexar: ninguém edita nem apaga.
        </p>
      </div>

      <CampoBusca
        acao="/admin/logs"
        valor={busca}
        placeholder="Filtrar por entidade (ex.: stores)"
      />

      {lista.length === 0 ? (
        <EstadoVazio
          icone={ScrollText}
          titulo={busca === '' ? 'Nenhum registro ainda' : 'Nada encontrado'}
          descricao={
            busca === ''
              ? 'As ações aparecem aqui conforme os clientes usam o painel.'
              : `Nenhum registro corresponde a “${busca}”.`
          }
        />
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Organização</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Entidade</TableHead>
                  <TableHead>Campos alterados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((log) => {
                  const org = log.organizations;
                  const campos =
                    log.diff != null && typeof log.diff === 'object' && !Array.isArray(log.diff)
                      ? Object.keys(log.diff)
                      : [];
                  return (
                    <TableRow key={log.id}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('pt-BR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </TableCell>
                      <TableCell>
                        {org == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Button variant="link" size="sm" className="h-auto p-0" asChild>
                            <Link href={`/admin/organizacoes/${org.id}`}>{org.name}</Link>
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{ROTULO_ACAO_AUDITORIA[log.action]}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{log.entity}</TableCell>
                      <TableCell className="text-muted-foreground max-w-[18rem] truncate text-xs">
                        {campos.length === 0 ? '—' : campos.join(', ')}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <Paginacao pagina={pagina} total={count ?? 0} base="/admin/logs" busca={busca} />
        </>
      )}
    </div>
  );
}

/** A03 — Organizações, com busca e paginação. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { ROTULO_STATUS_ORG } from '@storefy/db';
import { criarClientServidor } from '@/lib/supabase/server';
import { CampoBusca, Paginacao, lerParams } from '../paginacao';
import { termoParaIlike } from '@/lib/listagem';
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

export const metadata: Metadata = { title: 'Organizações · Admin' };

export default async function PaginaOrganizacoes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const { busca, pagina, de, ate } = lerParams(await searchParams);
  const supabase = await criarClientServidor();

  let consulta = supabase
    .from('organizations')
    .select('id, name, slug, status, plan, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(de, ate);

  if (busca !== '') {
    // Escapa a vírgula, que separa cláusulas na sintaxe `or` do PostgREST.
    const termo = termoParaIlike(busca);
    consulta = consulta.or(`name.ilike.%${termo}%,slug.ilike.%${termo}%`);
  }

  const { data: organizacoes, count, error } = await consulta;
  if (error != null) throw new Error(`Não foi possível carregar as organizações: ${error.message}`);

  const lista = organizacoes;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Organizações</h1>
        <p className="text-muted-foreground mt-1 text-sm">Todos os clientes da plataforma.</p>
      </div>

      <CampoBusca
        acao="/admin/organizacoes"
        valor={busca}
        placeholder="Buscar por nome ou identificador"
      />

      {lista.length === 0 ? (
        <EstadoVazio
          icone={Building2}
          titulo={busca === '' ? 'Nenhuma organização ainda' : 'Nada encontrado'}
          descricao={
            busca === ''
              ? 'As organizações aparecem aqui conforme os clientes se cadastram.'
              : `Nenhuma organização corresponde a “${busca}”.`
          }
        />
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Identificador</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Criada em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">{org.name}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {org.slug}
                    </TableCell>
                    <TableCell>{org.plan}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ROTULO_STATUS_ORG[org.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(org.created_at).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/organizacoes/${org.id}`}>Detalhes</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Paginacao pagina={pagina} total={count ?? 0} base="/admin/organizacoes" busca={busca} />
        </>
      )}
    </div>
  );
}

/** Lojas de todas as organizações, com busca e paginação. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Store } from 'lucide-react';
import { ROTULO_STATUS_LOJA } from '@storefy/db';
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

export const metadata: Metadata = { title: 'Lojas · Admin' };

export default async function PaginaLojasAdmin({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const { busca, pagina, de, ate } = lerParams(await searchParams);
  const supabase = await criarClientServidor();

  let consulta = supabase
    .from('stores')
    .select('id, name, primary_url, status, created_at, org_id, organizations(id, name)', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(de, ate);

  if (busca !== '') {
    const termo = termoParaIlike(busca);
    consulta = consulta.or(`name.ilike.%${termo}%,primary_url.ilike.%${termo}%`);
  }

  const { data: lojas, count, error } = await consulta;
  if (error != null) throw new Error(`Não foi possível carregar as lojas: ${error.message}`);

  const lista = lojas;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lojas</h1>
        <p className="text-muted-foreground mt-1 text-sm">Todas as lojas da plataforma.</p>
      </div>

      <CampoBusca acao="/admin/lojas" valor={busca} placeholder="Buscar por nome ou endereço" />

      {lista.length === 0 ? (
        <EstadoVazio
          icone={Store}
          titulo={busca === '' ? 'Nenhuma loja ainda' : 'Nada encontrado'}
          descricao={
            busca === ''
              ? 'As lojas aparecem aqui conforme os clientes as cadastram.'
              : `Nenhuma loja corresponde a “${busca}”.`
          }
        />
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loja</TableHead>
                  <TableHead>Organização</TableHead>
                  <TableHead>Endereço</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Criada em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((loja) => {
                  const org = loja.organizations as { id: string; name: string } | null;
                  return (
                    <TableRow key={loja.id}>
                      <TableCell className="font-medium">{loja.name}</TableCell>
                      <TableCell>
                        {org == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Button variant="link" size="sm" className="h-auto p-0" asChild>
                            <Link href={`/admin/organizacoes/${org.id}`}>{org.name}</Link>
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[16rem] truncate">
                        {loja.primary_url}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{ROTULO_STATUS_LOJA[loja.status]}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(loja.created_at).toLocaleDateString('pt-BR')}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <Paginacao pagina={pagina} total={count ?? 0} base="/admin/lojas" busca={busca} />
        </>
      )}
    </div>
  );
}

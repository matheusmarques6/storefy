/** A04 — Detalhe da organização: lojas, membros e datas. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ROTULO_PAPEL, ROTULO_STATUS_LOJA, ROTULO_STATUS_ORG } from '@storefy/db';
import { criarClientServidor } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Organização · Admin' };

function dataHora(valor: string | null): string {
  if (valor == null) return '—';
  return new Date(valor).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default async function PaginaOrganizacao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await criarClientServidor();

  const [{ data: org }, { data: lojas, error: erroLojas }, { data: membros, error: erroMembros }] =
    await Promise.all([
      supabase.from('organizations').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('stores')
        .select('id, name, primary_url, status, created_at')
        .eq('org_id', id)
        .order('created_at', { ascending: true }),
      supabase.rpc('admin_membros_da_org', { p_org_id: id }),
    ]);

  if (org == null) notFound();
  // Erro de consulta vira erro visível: mostrar "nenhuma loja" quando na verdade
  // a query falhou faria o admin tirar a conclusão errada sobre o cliente.
  if (erroLojas != null) {
    throw new Error(`Não foi possível carregar as lojas: ${erroLojas.message}`);
  }
  if (erroMembros != null) {
    throw new Error(`Não foi possível carregar os membros: ${erroMembros.message}`);
  }

  const listaLojas = lojas;
  const listaMembros = membros;

  return (
    <div className="space-y-6">
      <Link
        href="/admin"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Voltar para organizações
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">{org.slug}</p>
        </div>
        <Badge variant="secondary">{ROTULO_STATUS_ORG[org.status]}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resumo</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Plano</dt>
              <dd className="mt-1 font-medium">{org.plan}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Lojas</dt>
              <dd className="mt-1 font-medium">{listaLojas.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Membros</dt>
              <dd className="mt-1 font-medium">{listaMembros.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Criada em</dt>
              <dd className="mt-1 font-medium">{dataHora(org.created_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Atualizada em</dt>
              <dd className="mt-1 font-medium">{dataHora(org.updated_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Teste até</dt>
              <dd className="mt-1 font-medium">{dataHora(org.trial_ends_at)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lojas</CardTitle>
          <CardDescription>
            {listaLojas.length === 0 ? 'Esta organização ainda não cadastrou nenhuma loja.' : null}
          </CardDescription>
        </CardHeader>
        {listaLojas.length === 0 ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Endereço</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criada em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listaLojas.map((loja) => (
                <TableRow key={loja.id}>
                  <TableCell className="font-medium">{loja.name}</TableCell>
                  <TableCell className="text-muted-foreground max-w-[16rem] truncate">
                    {loja.primary_url}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ROTULO_STATUS_LOJA[loja.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {dataHora(loja.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Membros</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>E-mail</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Entrou em</TableHead>
              <TableHead>Último acesso</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listaMembros.map((membro) => (
              <TableRow key={membro.user_id ?? membro.email}>
                <TableCell className="font-medium">{membro.email ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {membro.role == null ? '—' : ROTULO_PAPEL[membro.role]}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {dataHora(membro.created_at)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {dataHora(membro.ultimo_acesso)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

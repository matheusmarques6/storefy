/** A03 — Organizações, com busca e paginação. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { ROTULO_STATUS_ORG } from '@storefy/db';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { CampoBusca, Paginacao, lerParams } from '../paginacao';
import { termoParaIlike } from '@/lib/listagem';
import { FUSO_PADRAO, formatarData } from '@/lib/fuso';
import { emailConfigurado } from '@/lib/email';
import { configuracoesDaPlataforma } from '@/lib/configuracoes-da-plataforma-servidor';
import {
  ConvitesDaPlataforma,
  FormularioConviteDeLojista,
} from '../_convites/convites-da-plataforma';
import { lerConvitesDaPlataforma } from '../_convites/ler';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  await exigirPlatformAdmin();
  const { busca, pagina, de, ate } = lerParams(await searchParams);
  const supabase = await criarClientServidor();

  let consulta = supabase
    .from('organizations')
    .select('id, name, slug, status, trial_ends_at, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(de, ate);

  if (busca !== '') {
    // Escapa a vírgula, que separa cláusulas na sintaxe `or` do PostgREST.
    const termo = termoParaIlike(busca);
    consulta = consulta.or(`name.ilike.%${termo}%,slug.ilike.%${termo}%`);
  }

  const [{ data: organizacoes, count, error }, convites, { cadastroAberto }] = await Promise.all([
    consulta,
    lerConvitesDaPlataforma('conta'),
    configuracoesDaPlataforma(),
  ]);
  if (error != null) throw new Error(`Não foi possível carregar as organizações: ${error.message}`);

  const lista = organizacoes;

  // O plano de cada uma, da assinatura (a da página, numa consulta só).
  const { data: assinaturas, error: erroAssinaturas } =
    lista.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('subscriptions')
          .select('org_id, cancelada_em, plans(nome)')
          .in(
            'org_id',
            lista.map((org) => org.id),
          );
  if (erroAssinaturas != null) {
    throw new Error(`Não foi possível carregar os planos: ${erroAssinaturas.message}`);
  }
  const planoDe = new Map(
    assinaturas.map((assinatura) => [
      assinatura.org_id,
      assinatura.cancelada_em === null
        ? assinatura.plans.nome
        : `${assinatura.plans.nome} (cancelada)`,
    ]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Organizações</h1>
        <p className="text-muted-foreground mt-1 text-sm">Todos os clientes da plataforma.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Convidar lojista</CardTitle>
          <CardDescription>
            {cadastroAberto
              ? 'O cadastro está aberto, e qualquer lojista cria a conta sozinho. O convite serve para chamar alguém com o link pronto.'
              : 'O cadastro está fechado (A13): só entra quem tem convite. O lojista cria a conta pelo link, com a própria empresa.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <FormularioConviteDeLojista emailConfigurado={emailConfigurado()} />
          <div className="space-y-2">
            <p className="text-sm font-medium">Convites de lojista em aberto</p>
            <ConvitesDaPlataforma
              convites={convites}
              podeGerir
              vazio="Nenhum convite de lojista em aberto."
            />
          </div>
        </CardContent>
      </Card>

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
                    <TableCell>
                      {planoDe.get(org.id) ?? (
                        <span className="text-muted-foreground">
                          Teste até {formatarData(org.trial_ends_at, FUSO_PADRAO)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ROTULO_STATUS_ORG[org.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatarData(org.created_at, FUSO_PADRAO)}
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

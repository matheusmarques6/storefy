/**
 * A04 — a ficha de um cliente.
 *
 * É a tela que o suporte abre quando alguém liga. Junta o que está espalhado
 * pelas listas do admin — lojas, equipe, builds — recortado nesse cliente, e
 * acrescenta o que não existe em lugar nenhum: as NOTAS INTERNAS, que são o
 * que se sabe dele e hoje mora na cabeça de quem atendeu da última vez.
 *
 * As notas não são lidas pelo cliente, nem pelo dono da organização. Isso é
 * garantido pela RLS de `org_notes`, e provado por asserção — a policy natural
 * de escrever ("membros leem as notas da própria organização") entregaria a
 * ele tudo que a equipe anotou.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  ROTULO_PAPEL,
  ROTULO_STATUS_BUILD,
  ROTULO_STATUS_LOJA,
  ROTULO_STATUS_ORG,
} from '@storefy/db';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { lerNotas } from '@/lib/notas-internas';
import { FUSO_PADRAO, formatarDataHora } from '@/lib/fuso';
import { Notas } from './notas';
import { VerComoCliente } from './ver-como-cliente';
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

/** No fuso da equipe: a Vercel roda em UTC, e sem isto toda hora saía três horas adiantada. */
function dataHora(valor: string | null): string {
  return formatarDataHora(valor, FUSO_PADRAO);
}

export default async function PaginaOrganizacao({ params }: { params: Promise<{ id: string }> }) {
  await exigirPlatformAdmin();
  const { id } = await params;
  const supabase = await criarClientServidor();

  const [
    { data: org },
    { data: lojas, error: erroLojas },
    { data: membros, error: erroMembros },
    { data: notasBrutas, error: erroNotas },
    { data: builds, error: erroBuilds },
  ] = await Promise.all([
    supabase.from('organizations').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('stores')
      .select('id, name, primary_url, status, created_at')
      .eq('org_id', id)
      .order('created_at', { ascending: true }),
    supabase.rpc('admin_membros_da_org', { p_org_id: id }),
    supabase.rpc('admin_notas_da_org', { p_org_id: id }),
    /*
     * Os builds deste cliente, pelos apps das lojas dele. O filtro é por
     * `stores.org_id` e não por uma lista de ids montada aqui: duas consultas
     * em sequência deixariam a segunda ver um estado diferente da primeira.
     */
    supabase
      .from('builds')
      .select('id, platform, status, version, created_at, apps!inner(stores!inner(org_id, name))')
      .eq('apps.stores.org_id', id)
      .order('created_at', { ascending: false })
      .limit(5),
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
  if (erroNotas != null) {
    throw new Error(`Não foi possível carregar as notas: ${erroNotas.message}`);
  }
  if (erroBuilds != null) {
    throw new Error(`Não foi possível carregar os builds: ${erroBuilds.message}`);
  }

  const listaLojas = lojas;
  const listaMembros = membros;
  const notas = lerNotas(notasBrutas);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/organizacoes"
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
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{ROTULO_STATUS_ORG[org.status]}</Badge>
          <VerComoCliente orgId={org.id} nome={org.name} />
        </div>
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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Últimos builds</CardTitle>
            <Link
              href="/admin/builds?filtro=todos"
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              Ver a fila inteira
            </Link>
          </div>
          <CardDescription>As cinco publicações mais recentes deste cliente.</CardDescription>
        </CardHeader>
        <CardContent>
          {builds.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Este cliente ainda não publicou nenhum app.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {builds.map((build) => (
                <li key={build.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {build.apps.stores.name}
                    <span className="text-muted-foreground ml-2 text-xs">
                      {build.platform === 'ios' ? 'iOS' : 'Android'}
                      {build.version == null ? '' : ` · ${build.version}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge
                      variant={
                        build.status === 'errored' || build.status === 'rejected'
                          ? 'destructive'
                          : 'secondary'
                      }
                    >
                      {ROTULO_STATUS_BUILD[build.status]}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {dataHora(build.created_at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Notas orgId={id} notas={notas} />
    </div>
  );
}

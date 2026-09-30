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
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  ROTULO_PAPEL,
  ROTULO_STATUS_BUILD,
  ROTULO_STATUS_LOJA,
  ROTULO_STATUS_ORG,
  ROTULO_ACAO_AUDITORIA,
} from '@storefy/db';
import { exigirPlatformAdminComPapel } from '@/lib/contexto';
import { autoresDaAuditoria } from '@/lib/auditoria-admin';
import { AutorDaLinha } from '@/components/autor-da-auditoria';
import { criarClientServidor } from '@/lib/supabase/server';
import { lerNotas } from '@/lib/notas-internas';
import { FUSO_PADRAO, formatarDataHora } from '@/lib/fuso';
import { resumoDaShopify } from '@/lib/integracoes';
import { Notas } from './notas';
import { VerComoCliente } from './ver-como-cliente';
import { AppsDaOrganizacao } from './apps-da-organizacao';
import { CobrancaDaOrganizacao } from './cobranca-da-organizacao';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PrazoDoConvite } from '@/components/prazo-do-convite';
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
  const { papel } = await exigirPlatformAdminComPapel();
  const { id } = await params;
  const supabase = await criarClientServidor();

  const [
    { data: org, error: erroOrg },
    { data: lojas, error: erroLojas },
    { data: membros, error: erroMembros },
    { data: notasBrutas, error: erroNotas },
    { data: builds, error: erroBuilds },
    { data: convites, error: erroConvites },
    { data: acoes, error: erroAcoes },
  ] = await Promise.all([
    supabase.from('organizations').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('stores')
      .select(
        'id, name, primary_url, status, created_at, shopify_scopes, shopify_avisos_faltando, shopify_acesso_recusado_em',
      )
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
    // Convites em aberto: é o que responde "convidei e a pessoa não entrou".
    supabase
      .from('invitations')
      .select('id, email, org_role, expires_at')
      .eq('org_id', id)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
    // As últimas ações na trilha, para o suporte ver o que mudou por último
    // sem sair da página do cliente (A04 › logs).
    supabase
      .from('audit_logs')
      .select('id, action, entity, created_at, actor_id')
      .eq('org_id', id)
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  // Erro de leitura não é "cliente inexistente": o 404 esconderia a falha.
  if (erroOrg != null) {
    throw new Error(`Não foi possível carregar a organização: ${erroOrg.message}`);
  }
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
  if (erroConvites != null) {
    throw new Error(`Não foi possível carregar os convites: ${erroConvites.message}`);
  }
  if (erroAcoes != null) {
    throw new Error(`Não foi possível carregar as últimas ações: ${erroAcoes.message}`);
  }
  const autores = await autoresDaAuditoria(
    supabase,
    acoes.map((acao) => acao.actor_id),
  );

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
          </dl>
        </CardContent>
      </Card>

      <CobrancaDaOrganizacao orgId={org.id} papel={papel} />

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
                <TableHead>Shopify</TableHead>
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
                  <TableCell>
                    <SeloDaShopify
                      resumo={resumoDaShopify({
                        escopos: loja.shopify_scopes,
                        avisosFaltando: loja.shopify_avisos_faltando,
                        acessoRecusadoEm: loja.shopify_acesso_recusado_em,
                      })}
                    />
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

      <AppsDaOrganizacao lojas={listaLojas.map((loja) => ({ id: loja.id, name: loja.name }))} />

      <Card role="region" aria-labelledby="titulo-dos-membros">
        <CardHeader>
          <CardTitle id="titulo-dos-membros" className="text-base">
            Membros
          </CardTitle>
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
        {convites.length === 0 ? null : (
          <CardContent className="border-t pt-4">
            <p className="text-sm font-medium">Convites em aberto</p>
            <ul className="text-muted-foreground mt-2 space-y-1 text-sm">
              {convites.map((convite) => (
                <li key={convite.id}>
                  <span className="text-foreground break-all">{convite.email}</span>
                  {' · '}
                  {convite.org_role == null ? '—' : ROTULO_PAPEL[convite.org_role]}
                  {' · '}
                  <PrazoDoConvite expiraEm={convite.expires_at} />
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Últimos builds</CardTitle>
            <Link
              href={`/admin/builds?filtro=todos&org=${org.id}` as Route}
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              Ver todos os builds deste cliente
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

      <Card role="region" aria-labelledby="titulo-das-ultimas-acoes">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle id="titulo-das-ultimas-acoes" className="text-base">
              Últimas ações
            </CardTitle>
            <Link
              href={`/admin/logs?org=${id}`}
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              Ver toda a trilha
            </Link>
          </div>
          <CardDescription>Quem fez o quê neste cliente, das mais recentes.</CardDescription>
        </CardHeader>
        <CardContent>
          {acoes.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma ação registrada ainda.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {acoes.map((acao) => (
                <li key={acao.id} className="flex flex-wrap items-start justify-between gap-2">
                  <AutorDaLinha
                    actorId={acao.actor_id}
                    autor={acao.actor_id === null ? undefined : autores.get(acao.actor_id)}
                  />
                  <span className="flex items-center gap-2">
                    <Badge variant="outline">{ROTULO_ACAO_AUDITORIA[acao.action]}</Badge>
                    <span className="font-mono text-xs">{acao.entity}</span>
                    <span className="text-muted-foreground text-xs">
                      {dataHora(acao.created_at)}
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

/**
 * A conexão com a Shopify de cada loja: "faltam avisos" e "acesso recusado"
 * são o que o suporte precisa ver antes de o cliente reclamar que as vendas
 * pelo app sumiram.
 */
function SeloDaShopify({ resumo }: { resumo: ReturnType<typeof resumoDaShopify> }) {
  if (resumo.tom === 'neutro') {
    return <span className="text-muted-foreground text-sm">{resumo.texto}</span>;
  }
  return (
    <Badge
      variant={
        resumo.tom === 'erro' ? 'destructive' : resumo.tom === 'atencao' ? 'outline' : 'secondary'
      }
    >
      {resumo.texto}
    </Badge>
  );
}

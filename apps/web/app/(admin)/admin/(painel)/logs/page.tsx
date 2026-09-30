/**
 * A12 — Logs de auditoria: quem fez o quê.
 *
 * O "quem" sai de `admin_autores_da_auditoria` (o e-mail mora em
 * `auth.users`). `?org=` filtra uma organização — é o "ver toda a trilha"
 * que sai da A04.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ScrollText } from 'lucide-react';
import { ROTULO_ACAO_AUDITORIA, type Json } from '@storefy/db';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { ehUuid } from '@/lib/app-config-publica';
import { autoresDaAuditoria } from '@/lib/auditoria-admin';
import { lido } from '@/lib/leitura';
import { AutorDaLinha } from '@/components/autor-da-auditoria';
import { CampoBusca, Paginacao, lerParams } from '../paginacao';
import { ehPaginaAlemDoFim, montarUrlDePagina, termoParaIlike } from '@/lib/listagem';
import { FUSO_PADRAO, formatarDataHora } from '@/lib/fuso';
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

/** Campos que mudaram, para a coluna de resumo. */
function camposAlterados(diff: Json | null): string[] {
  if (diff == null || typeof diff !== 'object' || Array.isArray(diff)) return [];
  return Object.keys(diff);
}

/**
 * Nome da organização guardado no diff.
 *
 * Numa linha de exclusão, o diff carrega todos os campos da linha removida,
 * inclusive o nome. É o que mantém a trilha legível depois que a organização
 * some — ver o comentário da coluna `audit_logs.org_id` na migration.
 */
function nomeNoDiff(diff: Json | null): string | null {
  if (diff == null || typeof diff !== 'object' || Array.isArray(diff)) return null;
  const campo = (diff as Record<string, Json | undefined>).name;
  if (campo == null || typeof campo !== 'object' || Array.isArray(campo)) return null;
  const de = (campo as Record<string, Json | undefined>).de;
  return typeof de === 'string' ? de : null;
}

export default async function PaginaLogs({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string; org?: string }>;
}) {
  await exigirPlatformAdmin();
  const parametros = await searchParams;
  const { busca, pagina, de, ate } = lerParams(parametros);
  // Um id que não é uuid não filtra nada — e não vira erro de consulta no banco.
  const orgFiltrada = ehUuid(parametros.org ?? '') ? (parametros.org ?? null) : null;
  const supabase = await criarClientServidor();

  let consulta = supabase
    .from('audit_logs')
    .select('id, action, entity, entity_id, diff, created_at, org_id, actor_id', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(de, ate);

  if (busca !== '') {
    const termo = termoParaIlike(busca);
    consulta = consulta.ilike('entity', `%${termo}%`);
  }
  if (orgFiltrada !== null) consulta = consulta.eq('org_id', orgFiltrada);

  const { data: logs, count, error } = await consulta;
  if (error != null) {
    // Página depois da última (item apagado, link antigo): volta para a primeira.
    if (ehPaginaAlemDoFim(error)) {
      redirect(
        montarUrlDePagina('/admin/logs', {
          busca,
          ...(orgFiltrada === null ? {} : { extras: { org: orgFiltrada } }),
        }),
      );
    }
    throw new Error(`Não foi possível carregar a auditoria: ${error.message}`);
  }

  const [autores, lidaOrgFiltrada] = await Promise.all([
    autoresDaAuditoria(
      supabase,
      logs.map((log) => log.actor_id),
    ),
    orgFiltrada === null
      ? null
      : supabase.from('organizations').select('name').eq('id', orgFiltrada).maybeSingle(),
  ]);
  const nomeDaOrgFiltrada =
    lidaOrgFiltrada === null ? null : (lido(lidaOrgFiltrada, 'a organização').data?.name ?? null);

  /*
   * A organização vem em consulta separada, e não por embed.
   *
   * `audit_logs.org_id` não tem chave estrangeira de propósito — é o que
   * permite a trilha sobreviver à exclusão da organização. Sem FK, o PostgREST
   * não resolve `organizations(...)` num select aninhado.
   */
  const idsDeOrg = [...new Set(logs.map((log) => log.org_id).filter((id) => id !== null))];

  const nomePorOrg = new Map<string, string>();
  if (idsDeOrg.length > 0) {
    const { data: orgs, error: erroOrgs } = await supabase
      .from('organizations')
      .select('id, name')
      .in('id', idsDeOrg);

    if (erroOrgs != null) {
      throw new Error(`Não foi possível carregar as organizações: ${erroOrgs.message}`);
    }
    for (const org of orgs) nomePorOrg.set(org.id, org.name);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auditoria</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Quem fez o quê. Os registros são somente-anexar: ninguém edita nem apaga.
        </p>
      </div>

      {orgFiltrada === null ? null : (
        <p className="text-sm">
          Só as ações de{' '}
          <Link href={`/admin/organizacoes/${orgFiltrada}`} className="font-medium underline">
            {nomeDaOrgFiltrada ?? 'uma organização excluída'}
          </Link>
          .{' '}
          <Link href="/admin/logs" className="text-muted-foreground underline">
            Ver todas
          </Link>
        </p>
      )}

      <CampoBusca
        acao="/admin/logs"
        valor={busca}
        placeholder="Filtrar por entidade (ex.: stores)"
        extras={orgFiltrada === null ? undefined : { org: orgFiltrada }}
      />

      {logs.length === 0 ? (
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
                  <TableHead>Quem</TableHead>
                  <TableHead>Organização</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Entidade</TableHead>
                  <TableHead>Campos alterados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const nomeAtual =
                    log.org_id == null ? null : (nomePorOrg.get(log.org_id) ?? null);
                  const nomeHistorico = nomeNoDiff(log.diff);
                  const campos = camposAlterados(log.diff);

                  return (
                    <TableRow key={log.id}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatarDataHora(log.created_at, FUSO_PADRAO)}
                      </TableCell>
                      <TableCell>
                        <AutorDaLinha
                          actorId={log.actor_id}
                          autor={log.actor_id === null ? undefined : autores.get(log.actor_id)}
                        />
                      </TableCell>
                      <TableCell>
                        {nomeAtual != null && log.org_id != null ? (
                          <Button variant="link" size="sm" className="h-auto p-0" asChild>
                            <Link href={`/admin/organizacoes/${log.org_id}`}>{nomeAtual}</Link>
                          </Button>
                        ) : nomeHistorico != null ? (
                          // Organização já excluída: mostra o nome que ficou na trilha.
                          <span className="text-muted-foreground">
                            {nomeHistorico} <span className="text-xs">(excluída)</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
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
          <Paginacao
            pagina={pagina}
            total={count ?? 0}
            base="/admin/logs"
            busca={busca}
            extras={orgFiltrada === null ? undefined : { org: orgFiltrada }}
          />
        </>
      )}
    </div>
  );
}

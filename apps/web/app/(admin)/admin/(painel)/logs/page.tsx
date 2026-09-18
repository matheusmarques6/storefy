/** A12 — Logs de auditoria. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ScrollText } from 'lucide-react';
import { ROTULO_ACAO_AUDITORIA, type Json } from '@storefy/db';
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
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const { busca, pagina, de, ate } = lerParams(await searchParams);
  const supabase = await criarClientServidor();

  let consulta = supabase
    .from('audit_logs')
    .select('id, action, entity, entity_id, diff, created_at, org_id', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(de, ate);

  if (busca !== '') {
    const termo = termoParaIlike(busca);
    consulta = consulta.ilike('entity', `%${termo}%`);
  }

  const { data: logs, count, error } = await consulta;
  if (error != null) throw new Error(`Não foi possível carregar a auditoria: ${error.message}`);

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

      <CampoBusca
        acao="/admin/logs"
        valor={busca}
        placeholder="Filtrar por entidade (ex.: stores)"
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
                        {new Date(log.created_at).toLocaleString('pt-BR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
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
          <Paginacao pagina={pagina} total={count ?? 0} base="/admin/logs" busca={busca} />
        </>
      )}
    </div>
  );
}

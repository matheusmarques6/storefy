/**
 * A05 — Fila de builds de todas as lojas.
 *
 * ABRE NO QUE QUEBROU, e não em "todos". Quem vem aqui está atrás de um build
 * com problema; numa plataforma com trezentos builds, abrir em "todos" enterra
 * os cinco que importam embaixo dos que deram certo. O recorte fica na URL,
 * então um link colado no chat do suporte leva a outra pessoa exatamente para
 * a mesma lista.
 *
 * O ERRO APARECE NA LINHA, inteiro, e não atrás de um clique: a mensagem da
 * EAS é o que diz se o problema é do cliente (credencial vencida) ou nosso
 * (workflow quebrado), e essa é a primeira pergunta que alguém faz.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink, Hammer } from 'lucide-react';
import { ROTULO_STATUS_BUILD } from '@storefy/db';
import { criarClientServidor } from '@/lib/supabase/server';
import {
  FILTROS,
  ROTULO_DO_FILTRO,
  lerFiltro,
  podeReexecutar,
  statusDoFiltro,
} from '@/lib/builds-admin';
import { Paginacao, lerParams } from '../paginacao';
import { BotaoReexecutar } from './botao-reexecutar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

export const metadata: Metadata = { title: 'Builds · Admin' };

const PLATAFORMA: Record<'ios' | 'android', string> = { ios: 'iOS', android: 'Android' };

export default async function PaginaBuilds({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string; pagina?: string }>;
}) {
  const params = await searchParams;
  const { pagina, de, ate } = lerParams(params);
  const filtro = lerFiltro(params.filtro);
  const supabase = await criarClientServidor();

  let consulta = supabase
    .from('builds')
    .select(
      'id, platform, profile, status, version, build_number, error, logs_url, created_at, apps(display_name, stores(name, organizations(name)))',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(de, ate);

  const status = statusDoFiltro(filtro);
  if (status !== null) consulta = consulta.in('status', status);

  const { data: builds, count, error } = await consulta;
  if (error != null) throw new Error(`Não foi possível carregar os builds: ${error.message}`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Builds</h1>
        <p className="text-muted-foreground mt-1 text-sm">A geração de apps de todas as lojas.</p>
      </div>

      <nav aria-label="Filtrar builds" className="flex flex-wrap gap-1">
        {FILTROS.map((opcao) => (
          <Link
            key={opcao}
            href={`/admin/builds?filtro=${opcao}`}
            aria-current={opcao === filtro ? 'page' : undefined}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              opcao === filtro
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            {ROTULO_DO_FILTRO[opcao]}
          </Link>
        ))}
      </nav>

      {builds.length === 0 ? (
        <EstadoVazio
          icone={Hammer}
          titulo={filtro === 'problema' ? 'Nenhum build com problema' : 'Nenhum build aqui'}
          descricao={
            filtro === 'problema'
              ? 'Nada falhou nem foi rejeitado. Os outros recortes mostram a fila inteira.'
              : 'Os builds aparecem aqui conforme os clientes publicam.'
          }
        />
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loja</TableHead>
                  <TableHead>Plataforma</TableHead>
                  <TableHead>Versão</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Quando</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {builds.map((build) => {
                  const loja = build.apps.stores;
                  const nomeDaLoja = loja.name;

                  return (
                    <TableRow key={build.id}>
                      <TableCell>
                        <span className="font-medium">{nomeDaLoja}</span>
                        <span className="text-muted-foreground mt-0.5 block text-xs">
                          {loja.organizations.name}
                        </span>
                        {build.error == null || build.error === '' ? null : (
                          /*
                           * O erro na própria linha: é ele que diz se o
                           * problema é do cliente ou nosso, e essa é a
                           * primeira pergunta de quem abre esta tela.
                           */
                          <span className="text-destructive mt-1 block text-xs break-words">
                            {build.error}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{PLATAFORMA[build.platform]}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {build.version ?? '—'}
                        {build.build_number == null ? '' : ` (${String(build.build_number)})`}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            build.status === 'errored' || build.status === 'rejected'
                              ? 'destructive'
                              : 'secondary'
                          }
                        >
                          {ROTULO_STATUS_BUILD[build.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(build.created_at).toLocaleString('pt-BR')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          {build.logs_url == null || build.logs_url === '' ? null : (
                            <Button variant="ghost" size="sm" asChild>
                              <a href={build.logs_url} target="_blank" rel="noreferrer">
                                Logs
                                <ExternalLink className="size-3" aria-hidden />
                              </a>
                            </Button>
                          )}
                          {podeReexecutar(build.status) ? (
                            <BotaoReexecutar buildId={build.id} loja={nomeDaLoja} />
                          ) : null}
                        </div>
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
            base="/admin/builds"
            busca=""
            extras={{ filtro }}
          />
        </>
      )}
    </div>
  );
}

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
 *
 * Além da situação, três recortes, todos na URL e somados: a busca pela loja
 * ou pelo cliente, a plataforma e o cliente vindo do detalhe da organização
 * (A04). É o caminho do suporte: "o build da loja X no iPhone".
 */
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ExternalLink, Hammer } from 'lucide-react';
import { ROTULO_STATUS_BUILD } from '@storefy/db';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { ehPaginaAlemDoFim, montarUrlDePagina, termoParaIlike } from '@/lib/listagem';
import {
  FILTROS,
  PLATAFORMAS_DO_FILTRO,
  ROTULO_DA_PLATAFORMA,
  ROTULO_DO_FILTRO,
  lerFiltro,
  lerOrganizacao,
  lerPlataforma,
  podeReexecutar,
  statusDoFiltro,
  type Filtro,
  type PlataformaDoFiltro,
} from '@/lib/builds-admin';
import { CampoBusca, Paginacao, lerParams } from '../paginacao';
import { BotaoReexecutar } from './botao-reexecutar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EstadoVazio } from '@/components/estado-vazio';
import { cn } from '@/lib/utils';
import { FUSO_PADRAO, formatarDataHora } from '@/lib/fuso';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Builds · Admin' };

/** Os filtros da tela, para montar os links sem perder os outros. */
interface Recorte {
  filtro: Filtro;
  plataforma: PlataformaDoFiltro | null;
  org: string | null;
  busca: string;
}

function extrasDo(recorte: Recorte): Record<string, string> {
  return {
    filtro: recorte.filtro,
    plataforma: recorte.plataforma ?? '',
    org: recorte.org ?? '',
  };
}

function urlDo(recorte: Recorte): string {
  return montarUrlDePagina('/admin/builds', {
    busca: recorte.busca,
    extras: extrasDo(recorte),
  });
}

export default async function PaginaBuilds({
  searchParams,
}: {
  searchParams: Promise<{
    filtro?: string;
    pagina?: string;
    q?: string;
    plataforma?: string;
    org?: string;
  }>;
}) {
  await exigirPlatformAdmin();
  const params = await searchParams;
  const { busca, pagina, de, ate } = lerParams(params);
  const recorte: Recorte = {
    filtro: lerFiltro(params.filtro),
    plataforma: lerPlataforma(params.plataforma),
    org: lerOrganizacao(params.org),
    busca,
  };
  const supabase = await criarClientServidor();

  // O nome do cliente do filtro, para a tela dizer de quem é a lista.
  let nomeDoCliente: string | null = null;
  if (recorte.org !== null) {
    const { data: organizacao, error: erroDoCliente } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', recorte.org)
      .maybeSingle();
    if (erroDoCliente != null) {
      throw new Error(`Não foi possível carregar o cliente: ${erroDoCliente.message}`);
    }
    // Um cliente que não existe (excluído, link antigo) sai do filtro.
    if (organizacao == null) redirect(urlDo({ ...recorte, org: null }));
    nomeDoCliente = organizacao.name;
  }

  /*
   * A busca casa o nome ou o endereço da loja, ou o nome do cliente. O nome do
   * cliente mora duas tabelas abaixo; os clientes que casam entram na busca da
   * loja pelo id.
   */
  let clientesDaBusca: string[] = [];
  const termo = termoParaIlike(busca);
  if (termo !== '') {
    const { data: clientes, error: erroDaBusca } = await supabase
      .from('organizations')
      .select('id')
      .ilike('name', `%${termo}%`)
      .limit(50);
    if (erroDaBusca != null) {
      throw new Error(`Não foi possível buscar os clientes: ${erroDaBusca.message}`);
    }
    clientesDaBusca = clientes.map((cliente) => cliente.id);
  }

  // `!inner`: os filtros da loja e do cliente recortam os builds, e não só o que vem junto.
  let consulta = supabase
    .from('builds')
    .select(
      'id, platform, profile, status, version, build_number, error, logs_url, created_at, apps!inner(display_name, stores!inner(name, org_id, organizations(name)))',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(de, ate);

  const status = statusDoFiltro(recorte.filtro);
  if (status !== null) consulta = consulta.in('status', status);
  if (recorte.plataforma !== null) consulta = consulta.eq('platform', recorte.plataforma);
  if (recorte.org !== null) consulta = consulta.eq('apps.stores.org_id', recorte.org);
  if (termo !== '') {
    const porCliente =
      clientesDaBusca.length === 0 ? '' : `,org_id.in.(${clientesDaBusca.join(',')})`;
    consulta = consulta.or(`name.ilike.%${termo}%,primary_url.ilike.%${termo}%${porCliente}`, {
      referencedTable: 'apps.stores',
    });
  }

  const { data: builds, count, error } = await consulta;
  if (error != null) {
    // Página depois da última (item apagado, link antigo): volta para a primeira.
    if (ehPaginaAlemDoFim(error)) redirect(urlDo(recorte));
    throw new Error(`Não foi possível carregar os builds: ${error.message}`);
  }
  const comRecorte = busca !== '' || recorte.plataforma !== null || recorte.org !== null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Builds</h1>
        <p className="text-muted-foreground mt-1 text-sm">A geração de apps de todas as lojas.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Filtrar builds" className="flex flex-wrap gap-1">
          {FILTROS.map((opcao) => (
            <Link
              key={opcao}
              href={urlDo({ ...recorte, filtro: opcao }) as Route}
              aria-current={opcao === recorte.filtro ? 'page' : undefined}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                opcao === recorte.filtro
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60',
              )}
            >
              {ROTULO_DO_FILTRO[opcao]}
            </Link>
          ))}
        </nav>

        <nav aria-label="Plataforma" className="border-input flex flex-wrap gap-1 border-l pl-3">
          {[null, ...PLATAFORMAS_DO_FILTRO].map((opcao) => (
            <Link
              key={opcao ?? 'as-duas'}
              href={urlDo({ ...recorte, plataforma: opcao }) as Route}
              aria-current={opcao === recorte.plataforma ? 'page' : undefined}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                opcao === recorte.plataforma
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60',
              )}
            >
              {opcao === null ? 'iOS e Android' : ROTULO_DA_PLATAFORMA[opcao]}
            </Link>
          ))}
        </nav>
      </div>

      <CampoBusca
        acao="/admin/builds"
        valor={busca}
        placeholder="Buscar pela loja ou pelo cliente"
        extras={Object.fromEntries(
          Object.entries(extrasDo(recorte)).filter(([, valor]) => valor !== ''),
        )}
      />

      {nomeDoCliente === null ? null : (
        <p className="text-sm">
          Só os builds de <span className="font-medium">{nomeDoCliente}</span>.{' '}
          <Link
            href={urlDo({ ...recorte, org: null })}
            className="text-primary underline-offset-4 hover:underline"
          >
            Ver de todos os clientes
          </Link>
        </p>
      )}

      {builds.length === 0 ? (
        <EstadoVazio
          icone={Hammer}
          titulo={
            comRecorte
              ? 'Nenhum build com esses filtros'
              : recorte.filtro === 'problema'
                ? 'Nenhum build com problema'
                : 'Nenhum build aqui'
          }
          descricao={
            comRecorte
              ? 'Tire um dos filtros, ou escolha outra situação, para ver mais.'
              : recorte.filtro === 'problema'
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
                      <TableCell>{ROTULO_DA_PLATAFORMA[build.platform]}</TableCell>
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
                        {formatarDataHora(build.created_at, FUSO_PADRAO)}
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
            busca={busca}
            extras={extrasDo(recorte)}
          />
        </>
      )}
    </div>
  );
}

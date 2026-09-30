/**
 * A06 — Apps na revisão da Apple e da Google.
 *
 * ORDENADA PELO MAIS ANTIGO, ao contrário de todas as outras listas do admin.
 * Aqui o interessante não é o que acabou de acontecer: é o que está parado há
 * tempo demais. Uma lista do mais novo para o mais velho empurra justamente
 * esses para a última página.
 *
 * O PRÓXIMO PASSO É O PRODUTO. Dois dias esperando a Apple é normal, doze
 * não é, e ninguém descobre isso lendo datas numa tabela; uma recusa tem um
 * conserto, e ninguém deveria precisar saber de cor qual. `proximoPassoDaRevisao`
 * diz em palavras o que fazer e quem faz — e sabe que o Android na trilha
 * interna não está esperando a Google, e sim o lojista promover a versão.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { ROTULO_STATUS_BUILD } from '@storefy/db';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { ehPaginaAlemDoFim } from '@/lib/listagem';
import { diasEsperando } from '@/lib/builds-admin';
import { proximoPassoDaRevisao, situacaoNaRevisao } from '@/lib/proximo-passo-da-revisao';
import { Paginacao, lerParams } from '../paginacao';
import { Badge } from '@/components/ui/badge';
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

export const metadata: Metadata = { title: 'Revisões · Admin' };

const PLATAFORMA: Record<'ios' | 'android', string> = { ios: 'Apple', android: 'Google' };

export default async function PaginaRevisoes({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string }>;
}) {
  await exigirPlatformAdmin();
  const { pagina, de, ate } = lerParams(await searchParams);
  const supabase = await criarClientServidor();

  const {
    data: builds,
    count,
    error,
  } = await supabase
    .from('builds')
    .select(
      'id, platform, status, version, error, submitted_at, updated_at, store_state, apps(display_name, stores(name, organizations(id, name)))',
      { count: 'exact' },
    )
    /*
     * O aprovado esperando o lojista liberar também entra: para o cliente, o
     * app não está na loja, e é a equipe quem lembra.
     */
    .or(
      'status.in.(submitted,in_review,rejected),and(status.eq.approved,store_state.eq.PENDING_DEVELOPER_RELEASE)',
    )
    // Do mais antigo para o mais novo: quem espera há mais tempo vem primeiro.
    // `nullsFirst: false` porque um build sem data de envio não é o mais
    // urgente — é um dado incompleto, e ele iria para o topo sem merecer.
    .order('submitted_at', { ascending: true, nullsFirst: false })
    .range(de, ate);

  if (error != null) {
    // Página depois da última (item apagado, link antigo): volta para a primeira.
    if (ehPaginaAlemDoFim(error)) redirect('/admin/revisoes');
    throw new Error(`Não foi possível carregar as revisões: ${error.message}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Revisões</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Apps esperando a Apple e a Google, os que voltaram rejeitados — e o próximo passo de cada
          um.
        </p>
      </div>

      {builds.length === 0 ? (
        <EstadoVazio
          icone={ShieldCheck}
          titulo="Nenhum app em revisão"
          descricao="Quando um cliente enviar um app para a Apple ou a Google, ele aparece aqui até a loja responder."
        />
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loja</TableHead>
                  <TableHead>Loja de apps</TableHead>
                  <TableHead>Versão</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Esperando</TableHead>
                  <TableHead>Próximo passo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {builds.map((build) => {
                  const loja = build.apps.stores;
                  const dias = diasEsperando(build.submitted_at);
                  const passo = proximoPassoDaRevisao(build);
                  const situacao = situacaoNaRevisao(build);

                  return (
                    <TableRow key={build.id}>
                      <TableCell>
                        <span className="font-medium">{loja.name}</span>
                        <Link
                          href={`/admin/organizacoes/${loja.organizations.id}`}
                          className="text-muted-foreground mt-0.5 block text-xs hover:underline"
                        >
                          {loja.organizations.name}
                        </Link>
                        {build.status === 'rejected' &&
                        build.error != null &&
                        build.error !== '' ? (
                          /*
                           * O motivo da recusa é o que alguém precisa ler para
                           * saber o que dizer ao cliente. Esconder atrás de um
                           * clique é fazer o suporte abrir trinta abas.
                           */
                          <span className="text-destructive mt-1 block text-xs break-words">
                            {build.error}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>{PLATAFORMA[build.platform]}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {build.version ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={build.status === 'rejected' ? 'destructive' : 'secondary'}>
                          {situacao ?? ROTULO_STATUS_BUILD[build.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {dias == null ? (
                          <span className="text-muted-foreground text-sm">—</span>
                        ) : (
                          <span className="text-sm">
                            {dias === 0 ? 'hoje' : `${String(dias)} dia${dias === 1 ? '' : 's'}`}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-sm">
                        <span
                          className={
                            passo.urgente
                              ? 'text-destructive flex items-start gap-1 text-sm font-medium'
                              : 'flex items-start gap-1 text-sm font-medium'
                          }
                        >
                          {passo.urgente ? (
                            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          ) : null}
                          {passo.titulo}
                        </span>
                        <span className="text-muted-foreground mt-1 block text-xs">
                          {passo.quem === 'lojista'
                            ? 'Com o lojista: '
                            : passo.quem === 'equipe'
                              ? 'Com a equipe: '
                              : ''}
                          {passo.detalhe}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <Paginacao pagina={pagina} total={count ?? 0} base="/admin/revisoes" busca="" />
        </>
      )}
    </div>
  );
}

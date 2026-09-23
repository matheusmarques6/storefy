/**
 * A06 — Apps na revisão da Apple e da Google.
 *
 * ORDENADA PELO MAIS ANTIGO, ao contrário de todas as outras listas do admin.
 * Aqui o interessante não é o que acabou de acontecer: é o que está parado há
 * tempo demais. Uma lista do mais novo para o mais velho empurra justamente
 * esses para a última página.
 *
 * O ALERTA É O PRODUTO. Dois dias esperando a Apple é normal, doze não é, e
 * ninguém descobre isso lendo datas numa tabela. `revisaoParada` faz a conta
 * e diz em palavras — e só para quem está mesmo esperando alguém de fora: um
 * build rejeitado não está parado, está esperando NÓS.
 */
import type { Metadata } from 'next';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { ROTULO_STATUS_BUILD } from '@storefy/db';
import { criarClientServidor } from '@/lib/supabase/server';
import { diasEsperando, revisaoParada } from '@/lib/builds-admin';
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
  const { pagina, de, ate } = lerParams(await searchParams);
  const supabase = await criarClientServidor();

  const {
    data: builds,
    count,
    error,
  } = await supabase
    .from('builds')
    .select(
      'id, platform, status, version, error, submitted_at, updated_at, apps(display_name, stores(name, organizations(name)))',
      { count: 'exact' },
    )
    .in('status', ['submitted', 'in_review', 'rejected'])
    // Do mais antigo para o mais novo: quem espera há mais tempo vem primeiro.
    // `nullsFirst: false` porque um build sem data de envio não é o mais
    // urgente — é um dado incompleto, e ele iria para o topo sem merecer.
    .order('submitted_at', { ascending: true, nullsFirst: false })
    .range(de, ate);

  if (error != null) throw new Error(`Não foi possível carregar as revisões: ${error.message}`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Revisões</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Apps esperando a Apple e a Google, e os que voltaram rejeitados.
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {builds.map((build) => {
                  const loja = build.apps.stores;
                  const dias = diasEsperando(build.submitted_at);
                  const alerta = revisaoParada(build.status, build.submitted_at);

                  return (
                    <TableRow key={build.id}>
                      <TableCell>
                        <span className="font-medium">{loja.name}</span>
                        <span className="text-muted-foreground mt-0.5 block text-xs">
                          {loja.organizations.name}
                        </span>
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
                          {ROTULO_STATUS_BUILD[build.status]}
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
                        {alerta == null ? null : (
                          <span className="text-destructive mt-1 flex items-start gap-1 text-xs">
                            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                            {alerta}
                          </span>
                        )}
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

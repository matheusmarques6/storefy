/**
 * A07 — Contas de desenvolvedor Apple e Google de cada cliente.
 *
 * É a tela que responde "por que a loja tal não consegue publicar?". Uma
 * credencial que expirou não avisa ninguém: o build só falha na próxima
 * tentativa, semanas depois, e o cliente acha que o produto quebrou.
 *
 * NENHUMA COLUNA `_enc` É LIDA AQUI, e isso não é descuido de escopo: a chave
 * da Apple e a conta de serviço da Google são invisíveis até para o dono da
 * organização, por `grant` de coluna. O que o suporte precisa é do ESTADO e do
 * identificador público (Team ID, Key ID) — o suficiente para conferir com o
 * cliente sem nunca ter o segredo na tela nem no histórico do navegador.
 *
 * As que estão com erro vêm primeiro: são as únicas que exigem alguém.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { criarClientServidor } from '@/lib/supabase/server';
import { Paginacao, lerParams } from '../paginacao';
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

export const metadata: Metadata = { title: 'Contas de desenvolvedor · Admin' };

const PLATAFORMA: Record<'apple' | 'google', string> = { apple: 'Apple', google: 'Google' };

const ROTULO_DO_ESTADO: Record<'pending' | 'invited' | 'verified' | 'error', string> = {
  pending: 'Não começou',
  invited: 'Convite enviado',
  verified: 'Verificada',
  error: 'Com erro',
};

const EXPLICACAO: Record<'pending' | 'invited' | 'verified' | 'error', string> = {
  pending: 'O cliente ainda não enviou as credenciais.',
  invited: 'Convite enviado, esperando o cliente aceitar.',
  verified: 'Funcionando. O cliente consegue publicar.',
  error: 'A credencial não vale mais. O cliente não consegue publicar até refazer.',
};

export default async function PaginaContas({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string }>;
}) {
  const { pagina, de, ate } = lerParams(await searchParams);
  const supabase = await criarClientServidor();

  const {
    data: contas,
    count,
    error,
  } = await supabase
    .from('developer_accounts')
    // Sem nenhuma coluna `_enc`: o segredo não passa por aqui.
    .select(
      'id, platform, status, apple_team_id, asc_key_id, verified_at, notes, created_at, org_id, organizations(name)',
      { count: 'exact' },
    )
    /*
     * As com erro primeiro, e só depois por data: ordenar só por data
     * enterraria uma credencial quebrada de seis meses atrás embaixo das
     * contas novas que estão funcionando.
     *
     * DESCENDENTE, e o motivo é do Postgres: ele ordena enum pela ordem de
     * DECLARAÇÃO, não alfabética, e `developer_account_status` foi declarado
     * ('pending', 'invited', 'verified', 'error'). Ascendente colocaria o erro
     * em último — exatamente o contrário do que esta tela existe para fazer.
     * Ordenar no servidor, e não no JavaScript, é o que faz a conta com erro
     * aparecer na primeira página em vez de ficar escondida na terceira.
     */
    .order('status', { ascending: false })
    .order('created_at', { ascending: false })
    .range(de, ate);

  if (error != null) {
    throw new Error(`Não foi possível carregar as contas: ${error.message}`);
  }

  const lista = contas;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contas de desenvolvedor</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          As credenciais Apple e Google de cada cliente. O segredo em si nunca aparece aqui.
        </p>
      </div>

      {lista.length === 0 ? (
        <EstadoVazio
          icone={KeyRound}
          titulo="Nenhuma conta conectada"
          descricao="As contas aparecem aqui conforme os clientes conectam Apple e Google para publicar."
        />
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organização</TableHead>
                  <TableHead>Plataforma</TableHead>
                  <TableHead>Identificadores</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((conta) => (
                  <TableRow key={conta.id}>
                    <TableCell className="font-medium">{conta.organizations.name}</TableCell>
                    <TableCell>{PLATAFORMA[conta.platform]}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {conta.apple_team_id == null && conta.asc_key_id == null ? (
                        '—'
                      ) : (
                        <>
                          {conta.apple_team_id == null ? null : (
                            <span className="block">Team {conta.apple_team_id}</span>
                          )}
                          {conta.asc_key_id == null ? null : (
                            <span className="block">Key {conta.asc_key_id}</span>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={conta.status === 'error' ? 'destructive' : 'secondary'}>
                        {ROTULO_DO_ESTADO[conta.status]}
                      </Badge>
                      <span className="text-muted-foreground mt-1 block text-xs">
                        {EXPLICACAO[conta.status]}
                      </span>
                      {conta.notes == null || conta.notes === '' ? null : (
                        <span className="text-muted-foreground mt-1 block text-xs break-words">
                          {conta.notes}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/organizacoes/${conta.org_id}`}>Ver cliente</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Paginacao pagina={pagina} total={count ?? 0} base="/admin/contas" busca="" />
        </>
      )}
    </div>
  );
}

/**
 * A11 — Equipe interna da Storefy.
 *
 * Quem está aqui enxerga TODOS os clientes. É a lista mais sensível do
 * produto, e por isso ela mostra na cara quem pode o quê, em vez de esconder
 * o papel atrás de um rótulo técnico.
 *
 * Até esta tela existir, somar um colega à equipe exigia rodar
 * `pnpm bootstrap:admin` com acesso ao banco de produção. Era o gargalo que
 * fazia uma tarefa de trinta segundos depender de quem tinha a chave.
 */
import type { Metadata } from 'next';
import { ShieldAlert, Users } from 'lucide-react';
import { exigirPlatformAdminComPapel } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { EXPLICACAO_PAPEL, ROTULO_PAPEL_ADMIN, lerEquipe } from '@/lib/equipe-admin';
import { AcoesDaLinha, Convidar } from './gerenciar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Equipe · Admin' };

export default async function PaginaEquipe() {
  const { usuario, papel } = await exigirPlatformAdminComPapel();
  const supabase = await criarClientServidor();

  const { data, error } = await supabase.rpc('admin_equipe');
  if (error != null) throw new Error(`Não foi possível carregar a equipe: ${error.message}`);

  const equipe = lerEquipe(data);
  const souSuperadmin = papel === 'superadmin';
  const superadmins = equipe.filter((p) => p.papel === 'superadmin').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Equipe</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Quem da Storefy tem acesso a este painel.
        </p>
      </div>

      {/*
       * O aviso do último superadmin aparece ANTES de alguém tentar: descobrir
       * a trava só ao clicar em remover é descobrir tarde, e a pessoa já
       * pensou que ia resolver por ali.
       */}
      {souSuperadmin && superadmins === 1 ? (
        <Card>
          <CardContent className="text-muted-foreground flex items-start gap-2 py-4 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Só existe um superadmin. Enquanto for assim, ele não pode ser removido nem rebaixado —
              a plataforma ficaria sem ninguém capaz de dar acesso a alguém. Promova outra pessoa
              antes de mexer nisso.
            </span>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pessoa</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Desde</TableHead>
              {souSuperadmin ? <TableHead className="text-right">Ações</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {equipe.map((pessoa) => {
              const souEu = pessoa.userId === usuario.id;

              return (
                <TableRow key={pessoa.userId}>
                  <TableCell>
                    <span className="font-medium break-words">{pessoa.email}</span>
                    {souEu ? (
                      <span className="text-muted-foreground mt-0.5 block text-xs">você</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={pessoa.papel === 'superadmin' ? 'default' : 'secondary'}>
                      {ROTULO_PAPEL_ADMIN[pessoa.papel]}
                    </Badge>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {EXPLICACAO_PAPEL[pessoa.papel]}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {pessoa.desde == null
                      ? '—'
                      : new Date(pessoa.desde).toLocaleDateString('pt-BR')}
                  </TableCell>
                  {souSuperadmin ? (
                    <TableCell className="text-right">
                      {/*
                       * Nada de ações na própria linha: as travas já recusam,
                       * e mostrar um botão que sempre responde "não pode" é
                       * prometer o que não se cumpre.
                       */}
                      {souEu ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        <AcoesDaLinha
                          userId={pessoa.userId}
                          email={pessoa.email}
                          papel={pessoa.papel}
                        />
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {souSuperadmin ? (
        <Convidar />
      ) : (
        <Card>
          <CardContent className="text-muted-foreground flex items-start gap-2 py-4 text-sm">
            <Users className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Seu papel é de suporte: você vê a equipe, mas quem altera é um superadmin. Peça a
              alguém da lista acima.
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

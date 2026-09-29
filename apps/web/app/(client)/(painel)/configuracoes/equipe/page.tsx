/**
 * C16 — Equipe: quem mexe no painel da empresa, com que papel, e os convites
 * em aberto.
 *
 * Todo mundo da empresa vê a equipe (como vê as lojas); só o proprietário
 * convida, muda papel e tira gente. Cada um pode sair — menos o último
 * proprietário, que antes passa a propriedade.
 */
import type { Metadata } from 'next';
import { Users } from 'lucide-react';
import { ROTULO_PAPEL, type MembershipRole } from '@storefy/db';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { emailConfigurado } from '@/lib/email';
import { O_QUE_O_PAPEL_PODE } from '@/lib/convites';
import { NavegacaoConfiguracoes } from '../navegacao-configuracoes';
import { FormularioDeConvite } from './formulario-convite';
import { ListaDeConvites } from './lista-convites';
import { ListaDeMembros } from './lista-membros';
import { SairDaEmpresa } from './sair-da-empresa';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EstadoVazio } from '@/components/estado-vazio';

export const metadata: Metadata = { title: 'Equipe' };

const ORDEM_DOS_PAPEIS: readonly MembershipRole[] = ['owner', 'admin', 'member'];

export default async function PaginaEquipe() {
  const { organizacao, papel, usuario, organizacoes, lojaAtiva, visita } =
    await exigirContextoCliente();
  const supabase = await criarClientServidor();

  const [membros, convites] = await Promise.all([
    supabase.rpc('membros_da_organizacao', { p_org_id: organizacao.id }),
    supabase
      .from('invitations')
      .select('id, email, org_role, expires_at, created_at')
      .eq('org_id', organizacao.id)
      .eq('kind', 'organizacao')
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
  ]);
  if (membros.error != null) {
    throw new Error(`Não foi possível carregar a equipe: ${membros.error.message}`);
  }
  if (convites.error != null) {
    throw new Error(`Não foi possível carregar os convites: ${convites.error.message}`);
  }

  const podeGerir = papel === 'owner' && visita == null;
  const proprietarios = membros.data.filter((membro) => membro.role === 'owner').length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <NavegacaoConfiguracoes atual="equipe" />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Equipe</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Quem mexe no painel de {organizacao.name}. Cada pessoa entra com o próprio e-mail e senha
          — ninguém precisa compartilhar a sua.
        </p>
      </div>

      {podeGerir ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Convidar alguém</CardTitle>
            <CardDescription>
              A pessoa recebe um link para entrar na equipe com o papel que você escolher. O link
              vale por 7 dias e só funciona para o e-mail convidado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormularioDeConvite emailConfigurado={emailConfigurado()} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Pessoas na equipe <span className="text-muted-foreground">({membros.data.length})</span>
          </CardTitle>
          {podeGerir ? null : (
            <CardDescription>
              Só o proprietário convida pessoas e muda papéis. Seu papel:{' '}
              {ROTULO_PAPEL[papel].toLowerCase()}.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <ListaDeMembros
            membros={membros.data.map((membro) => ({
              id: membro.user_id ?? '',
              email: membro.email ?? '',
              nome: membro.nome,
              papel: membro.role ?? 'member',
              desde: membro.created_at,
              ultimoAcesso: membro.ultimo_acesso,
            }))}
            euId={usuario.id}
            podeGerir={podeGerir}
            fuso={lojaAtiva?.timezone ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Convites em aberto</CardTitle>
          <CardDescription>
            Quem foi convidado e ainda não entrou. Um convite vencido pode ser reenviado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {convites.data.length === 0 ? (
            <EstadoVazio
              icone={Users}
              titulo="Nenhum convite em aberto"
              descricao={
                podeGerir
                  ? 'Convide quem ajuda na loja: cada pessoa entra com o próprio acesso.'
                  : 'Quando o proprietário convidar alguém, o convite aparece aqui até a pessoa entrar.'
              }
              className="py-10"
            />
          ) : (
            <ListaDeConvites
              convites={convites.data.map((convite) => ({
                id: convite.id,
                email: convite.email,
                papel: convite.org_role ?? 'member',
                expiraEm: convite.expires_at,
              }))}
              podeGerir={podeGerir}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">O que cada papel pode</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            {ORDEM_DOS_PAPEIS.map((item) => (
              <div key={item}>
                <dt className="font-medium">{ROTULO_PAPEL[item]}</dt>
                <dd className="text-muted-foreground">{O_QUE_O_PAPEL_PODE[item]}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {visita == null ? (
        <SairDaEmpresa
          empresa={organizacao.name}
          unicoProprietario={papel === 'owner' && proprietarios <= 1}
          unicaEmpresa={organizacoes.length <= 1}
        />
      ) : null}
    </div>
  );
}

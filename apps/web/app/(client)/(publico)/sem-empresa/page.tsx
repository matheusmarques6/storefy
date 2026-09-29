/**
 * C16 — conta sem empresa nenhuma.
 *
 * Acontece com quem saiu da única empresa em que estava, ou foi tirado dela.
 * Antes, o painel caía com "fale com o suporte". Agora a pessoa vê os
 * convites em aberto para o e-mail dela, pode criar a própria empresa (com o
 * cadastro aberto), ou sair.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { ROTULO_PAPEL } from '@storefy/db';
import { criarClientServidor } from '@/lib/supabase/server';
import { configuracoesDaPlataforma } from '@/lib/configuracoes-da-plataforma-servidor';
import { FUSO_PADRAO, formatarData } from '@/lib/fuso';
import { lido } from '@/lib/leitura';
import { sair } from '../acoes';
import { AceitarDaLista, CriarEmpresa } from './formularios';
import { ExcluirConta } from '../../(painel)/configuracoes/conta/excluir-conta';
import { dadosDaExclusao } from '../../(painel)/configuracoes/conta/dados-da-exclusao';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Sem empresa' };

export default async function PaginaSemEmpresa() {
  const supabase = await criarClientServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user == null) redirect('/entrar');

  const [lidaContagem, lidosConvites, { cadastroAberto }] = await Promise.all([
    supabase
      .from('memberships')
      .select('org_id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase.rpc('meus_convites'),
    configuracoesDaPlataforma(),
  ]);
  /*
   * Sem ler, quem TEM empresa leria "sua conta não está em nenhuma empresa" —
   * e poderia criar outra —, e quem tem convite leria que não tem nenhum.
   */
  const { count } = lido(lidaContagem, 'as suas empresas');
  const { data: convites } = lido(lidosConvites, 'os seus convites');

  // Quem tem empresa não tem o que fazer aqui.
  if ((count ?? 0) > 0) redirect('/');

  const lista = convites ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-5" aria-hidden />
            Sua conta não está em nenhuma empresa
          </CardTitle>
          <CardDescription>
            Você saiu da empresa em que estava, ou foi tirado dela. Seus dados de acesso continuam
            valendo ({user.email}).
          </CardDescription>
        </CardHeader>
        {lista.length === 0 ? null : (
          <CardContent className="space-y-3">
            <p className="text-sm font-medium">Convites para você</p>
            <ul className="divide-y rounded-lg border">
              {lista.map((convite) => (
                <li
                  key={convite.id ?? ''}
                  className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">{convite.organizacao}</p>
                    <p className="text-muted-foreground text-xs">
                      {convite.papel == null ? null : `${ROTULO_PAPEL[convite.papel]} · `}
                      convite de {convite.convidado_por ?? 'alguém da empresa'}, vale até{' '}
                      {formatarData(convite.expira_em, FUSO_PADRAO)}
                    </p>
                  </div>
                  <AceitarDaLista id={convite.id ?? ''} empresa={convite.organizacao ?? ''} />
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Criar a sua empresa</CardTitle>
          <CardDescription>
            {cadastroAberto
              ? 'Comece do zero, com você como proprietário.'
              : 'Os cadastros estão fechados por enquanto. Para voltar a um painel, peça um convite a uma empresa que já usa a Storefy.'}
          </CardDescription>
        </CardHeader>
        {cadastroAberto ? (
          <CardContent>
            <CriarEmpresa />
          </CardContent>
        ) : null}
      </Card>

      <ExcluirConta email={user.email ?? ''} {...await dadosDaExclusao(user)} />

      <form action={sair}>
        <Button type="submit" variant="ghost" className="w-full">
          Sair da conta
        </Button>
      </form>
    </div>
  );
}

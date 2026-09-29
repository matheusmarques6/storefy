import 'server-only';

/**
 * Contexto multi-tenant de cada request do painel do cliente.
 *
 * Regra 2 das inegociáveis: a loja selecionada define o contexto de todas as
 * telas, e nenhuma query confia em filtro do front. O id da loja vem de um
 * cookie, mas é SEMPRE reconferido contra o que o banco devolve — um cookie
 * adulterado com o id de outra organização simplesmente não encontra a loja,
 * porque a RLS já filtrou a consulta.
 */
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import {
  COLUNAS_DA_LOJA,
  type LojaVisivel,
  type MembershipRole,
  type Organization,
  type PlatformAdminRole,
} from '@storefy/db';
import { criarClientServidor } from '@/lib/supabase/server';
import { visitaDoPedido, type DadosDaVisita } from '@/lib/visita';
import { COOKIE_LOJA_DA_VISITA } from '@/lib/visita-nomes';
import { log } from '@/lib/log';

export const COOKIE_ORG = 'storefy_org';
export const COOKIE_LOJA = 'storefy_loja';

const UM_ANO = 60 * 60 * 24 * 365;

/**
 * Faz de uma empresa a ativa, e esquece a loja (que era da anterior).
 *
 * Quem chama já garantiu que a pessoa é membro — o contexto ainda confere a
 * cada request, e um cookie de empresa alheia é simplesmente ignorado.
 */
export async function definirEmpresaAtiva(orgId: string): Promise<void> {
  const armazem = await cookies();
  armazem.set(COOKIE_ORG, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: UM_ANO,
  });
  armazem.delete(COOKIE_LOJA);
}

export interface ContextoCliente {
  usuario: User;
  organizacao: Organization;
  papel: MembershipRole;
  /** Todas as organizações do usuário, para trocar de contexto. */
  organizacoes: { organizacao: Organization; papel: MembershipRole }[];
  /** Lojas da organização ativa, sem as colunas de segredo. */
  lojas: LojaVisivel[];
  /** Loja selecionada. Null só quando a organização ainda não tem nenhuma. */
  lojaAtiva: LojaVisivel | null;
  /**
   * Preenchido quando é a EQUIPE vendo o painel deste cliente ("Ver como
   * cliente", A04). Nesse caso `papel` é `member` — as telas escondem o que
   * escreve — e o proxy recusa qualquer escrita. Ver `lib/visita.ts`.
   */
  visita: { expiraEm: string } | null;
}

/** Usuário autenticado, ou null. */
export async function obterUsuario(): Promise<User | null> {
  const supabase = await criarClientServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Contexto completo. Redireciona para o login se não houver sessão.
 *
 * O Supabase Auth já bloqueia login sem e-mail confirmado quando a confirmação
 * está ativa no projeto, então não há checagem duplicada aqui.
 */
export async function exigirContextoCliente(): Promise<ContextoCliente> {
  const supabase = await criarClientServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user == null) redirect('/entrar');

  const visita = await visitaDoPedido(supabase, user.id);
  if (visita != null) {
    const daVisita = await contextoDaVisita(supabase, user, visita);
    // Organização que não existe mais: a visita não tem o que mostrar, e o
    // painel volta a ser o da própria pessoa.
    if (daVisita != null) return daVisita;
  }

  /*
   * `user_id` no filtro, e não só na RLS. A policy de `memberships` deixa a
   * equipe da plataforma ler TODOS os vínculos — é o que o admin precisa —, e
   * sem este filtro um admin que abrisse o painel do cliente caía na
   * organização mais antiga da plataforma, que podia ser de outro cliente, com
   * o papel de outra pessoa. "Minhas organizações" é pergunta sobre o usuário,
   * e a consulta precisa dizer isso.
   */
  const { data: vinculos, error: erroVinculos } = await supabase
    .from('memberships')
    .select('role, organizations(*)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (erroVinculos != null) {
    throw new Error(`Não foi possível carregar suas organizações: ${erroVinculos.message}`);
  }

  const organizacoes = vinculos
    .flatMap((vinculo) => {
      const organizacao = vinculo.organizations as Organization | null;
      return organizacao == null ? [] : [{ organizacao, papel: vinculo.role }];
    })
    .sort((a, b) => a.organizacao.created_at.localeCompare(b.organizacao.created_at));

  if (organizacoes.length === 0) {
    /*
     * Conta sem empresa: saiu da única em que estava, ou o proprietário a
     * tirou. Antes isto era um erro ("fale com o suporte"); agora há uma tela
     * para aceitar um convite em aberto ou criar a própria empresa.
     */
    redirect('/sem-empresa');
  }

  const armazem = await cookies();
  const orgPreferida = armazem.get(COOKIE_ORG)?.value;
  const escolhida =
    organizacoes.find((item) => item.organizacao.id === orgPreferida) ?? organizacoes[0];
  // organizacoes tem ao menos um item (checado acima), mas o compilador não sabe.
  if (escolhida == null) throw new Error('Organização não encontrada.');

  const { data: lojas, error: erroLojas } = await supabase
    .from('stores')
    // Colunas listadas, e não `*`: o banco revoga a leitura de
    // `shopify_access_token_enc` para `authenticated`, então um `*` aqui
    // falharia com "permission denied" em vez de trazer a loja.
    .select(COLUNAS_DA_LOJA)
    .eq('org_id', escolhida.organizacao.id)
    .order('created_at', { ascending: true });

  if (erroLojas != null) {
    throw new Error(`Não foi possível carregar suas lojas: ${erroLojas.message}`);
  }

  const listaLojas = lojas;
  const lojaPreferida = armazem.get(COOKIE_LOJA)?.value;
  const lojaAtiva = listaLojas.find((loja) => loja.id === lojaPreferida) ?? listaLojas[0] ?? null;

  return {
    usuario: user,
    organizacao: escolhida.organizacao,
    papel: escolhida.papel,
    organizacoes,
    lojas: listaLojas,
    lojaAtiva,
    visita: null,
  };
}

/**
 * O painel do cliente visitado, lido com a sessão da própria equipe.
 *
 * Quem abre é o admin, com a sessão DELE: as leituras passam pelas policies
 * que terminam em `or is_platform_admin()`, e nenhuma escrita passa — a equipe
 * não tem policy de escrita nas tabelas do cliente. O papel devolvido é
 * `member` para as telas esconderem o que escreve.
 */
async function contextoDaVisita(
  supabase: Awaited<ReturnType<typeof criarClientServidor>>,
  usuario: User,
  visita: DadosDaVisita,
): Promise<ContextoCliente | null> {
  const { data: organizacao, error: erroDaOrganizacao } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', visita.orgId)
    .maybeSingle();
  if (erroDaOrganizacao != null) {
    throw new Error(`Não foi possível carregar o cliente: ${erroDaOrganizacao.message}`);
  }
  if (organizacao == null) return null;

  const { data: lojas, error } = await supabase
    .from('stores')
    .select(COLUNAS_DA_LOJA)
    .eq('org_id', visita.orgId)
    .order('created_at', { ascending: true });
  if (error != null) {
    throw new Error(`Não foi possível carregar as lojas do cliente: ${error.message}`);
  }

  const armazem = await cookies();
  const preferida = armazem.get(COOKIE_LOJA_DA_VISITA)?.value;
  const lojaAtiva = lojas.find((loja) => loja.id === preferida) ?? lojas[0] ?? null;

  return {
    usuario,
    organizacao,
    papel: 'member',
    organizacoes: [{ organizacao, papel: 'member' }],
    lojas,
    lojaAtiva,
    visita: { expiraEm: new Date(visita.expiraEm).toISOString() },
  };
}

/**
 * Guarda do painel admin.
 *
 * Confere `platform_admins` no banco a cada request. Não há atalho por cookie
 * nem por claim: o único lugar que decide quem é da equipe é a tabela.
 */
export async function exigirPlatformAdmin(): Promise<User> {
  return (await exigirPlatformAdminComPapel()).usuario;
}

/**
 * O mesmo crivo, devolvendo também o PAPEL.
 *
 * TODA PÁGINA DO ADMIN CHAMA ISTO, E NÃO SÓ O LAYOUT. No App Router o layout
 * e a página renderizam EM PARALELO: o `redirect` do layout não impede a
 * página de executar. Enquanto só o layout se guardava, um usuário comum que
 * abrisse `/admin` fazia a A02 rodar `resumo_do_admin` — que recusa com
 * exceção —, e cada visita virava um erro 500 no log por trás de um redirect
 * que parecia funcionar. O e2e achou isso na primeira vez que rodou contra um
 * Supabase de verdade; `admin-guardado.test.ts` impede que volte.
 *
 * O `cache()` do React faz layout e página dividirem UMA consulta por
 * request: chamar duas vezes não custa duas idas ao banco.
 *
 * O papel já era lido aqui e jogado fora. A A11 precisa dele: `support` lê a
 * equipe, `superadmin` mexe nela. Uma função separada em vez de mudar o
 * retorno de `exigirPlatformAdmin` porque os dez chamadores existentes não
 * precisam do papel, e trocar o tipo de todos para ganhar um campo que nove
 * ignoram é barulho no diff de quem vier depois.
 */
export const exigirPlatformAdminComPapel = cache(
  async function exigirPlatformAdminComPapel(): Promise<{
    usuario: User;
    papel: PlatformAdminRole;
  }> {
    const supabase = await criarClientServidor();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user == null) redirect('/admin/entrar');

    const { data: registro, error } = await supabase
      .from('platform_admins')
      .select('user_id, role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error != null) {
      throw new Error(`Não foi possível validar seu acesso de administrador: ${error.message}`);
    }
    if (registro == null) redirect('/admin/sem-acesso');

    return { usuario: user, papel: registro.role };
  },
);

/** True se o usuário pertence à equipe Storefy. Usado para exibir o atalho do admin. */
export async function ehPlatformAdmin(userId: string): Promise<boolean> {
  const supabase = await criarClientServidor();
  const { data, error } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  // Na dúvida, sem o atalho: ele só LEVA ao admin, que confere de novo.
  if (error != null) log.aviso('contexto.equipe-nao-conferida', { falha: error });
  return data != null;
}

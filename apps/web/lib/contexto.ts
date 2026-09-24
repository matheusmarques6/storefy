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

export const COOKIE_ORG = 'storefy_org';
export const COOKIE_LOJA = 'storefy_loja';

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

  const { data: vinculos, error: erroVinculos } = await supabase
    .from('memberships')
    .select('role, organizations(*)')
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
    // O trigger handle_new_user cria a organização no cadastro, então chegar
    // aqui significa que o trigger não rodou. Falhar alto é melhor do que
    // mostrar um painel vazio e deixar o usuário achar que perdeu os dados.
    throw new Error(
      'Sua conta não está vinculada a nenhuma organização. Fale com o suporte para resolvermos.',
    );
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
 * O papel já era lido aqui e jogado fora. A A11 precisa dele: `support` lê a
 * equipe, `superadmin` mexe nela. Uma função separada em vez de mudar o
 * retorno de `exigirPlatformAdmin` porque os dez chamadores existentes não
 * precisam do papel, e trocar o tipo de todos para ganhar um campo que nove
 * ignoram é barulho no diff de quem vier depois.
 */
export async function exigirPlatformAdminComPapel(): Promise<{
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
}

/** True se o usuário pertence à equipe Storefy. Usado para exibir o atalho do admin. */
export async function ehPlatformAdmin(userId: string): Promise<boolean> {
  const supabase = await criarClientServidor();
  const { data } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  return data != null;
}

'use server';

/** Ações do shell do painel: trocar de loja e de organização. */
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { COOKIE_LOJA, COOKIE_ORG } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';

const UM_ANO = 60 * 60 * 24 * 365;

/**
 * As organizações de que o usuário é MEMBRO.
 *
 * Pergunta feita com `user_id` explícito, e não deixada para a RLS: a equipe
 * da plataforma lê lojas e vínculos de todo mundo, e "posso ver" não é "é
 * minha". Sem isto, um admin gravava no cookie a loja de outro cliente.
 */
async function minhasOrganizacoes(
  supabase: Awaited<ReturnType<typeof criarClientServidor>>,
): Promise<Set<string>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user == null) return new Set();

  const { data: vinculos } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('user_id', user.id);
  return new Set((vinculos ?? []).map((vinculo) => vinculo.org_id));
}

/**
 * Define a loja ativa.
 *
 * Confere no banco antes de gravar o cookie. O contexto do painel já ignora
 * loja de fora das organizações do usuário, mas gravar um id que não vale
 * deixaria o painel em estado estranho — melhor rejeitar na entrada.
 */
export async function trocarLojaAtiva(lojaId: string): Promise<void> {
  const supabase = await criarClientServidor();
  const [{ data: loja }, minhas] = await Promise.all([
    supabase.from('stores').select('id, org_id').eq('id', lojaId).maybeSingle(),
    minhasOrganizacoes(supabase),
  ]);

  if (loja == null || !minhas.has(loja.org_id)) {
    throw new Error('Loja não encontrada ou sem permissão de acesso.');
  }

  const armazem = await cookies();
  armazem.set(COOKIE_LOJA, loja.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: UM_ANO,
  });
  // A organização acompanha a loja escolhida.
  armazem.set(COOKIE_ORG, loja.org_id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: UM_ANO,
  });

  revalidatePath('/', 'layout');
}

/** Define a organização ativa e limpa a loja, que pertence à anterior. */
export async function trocarOrganizacaoAtiva(orgId: string): Promise<void> {
  const supabase = await criarClientServidor();
  const minhas = await minhasOrganizacoes(supabase);

  if (!minhas.has(orgId)) {
    throw new Error('Organização não encontrada ou sem permissão de acesso.');
  }

  const armazem = await cookies();
  armazem.set(COOKIE_ORG, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: UM_ANO,
  });
  armazem.delete(COOKIE_LOJA);

  revalidatePath('/', 'layout');
}

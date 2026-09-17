'use server';

/** Ações do shell do painel: trocar de loja e de organização. */
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { COOKIE_LOJA, COOKIE_ORG } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';

const UM_ANO = 60 * 60 * 24 * 365;

/**
 * Define a loja ativa.
 *
 * Confere no banco antes de gravar o cookie. A RLS já impediria a leitura dos
 * dados de outra organização, mas gravar um id inválido deixaria o painel em
 * estado estranho — melhor rejeitar na entrada.
 */
export async function trocarLojaAtiva(lojaId: string): Promise<void> {
  const supabase = await criarClientServidor();
  const { data: loja } = await supabase
    .from('stores')
    .select('id, org_id')
    .eq('id', lojaId)
    .maybeSingle();

  if (loja == null) {
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
  const { data: vinculo } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('org_id', orgId)
    .maybeSingle();

  if (vinculo == null) {
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

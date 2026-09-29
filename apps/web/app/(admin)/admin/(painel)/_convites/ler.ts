import 'server-only';

/**
 * Os convites da plataforma em aberto, com quem convidou.
 *
 * Quem convida para a plataforma é sempre alguém da equipe, então o nome sai
 * da própria `admin_equipe` — sem abrir `auth.users` para mais nada.
 */
import { criarClientServidor } from '@/lib/supabase/server';
import { lerEquipe } from '@/lib/equipe-admin';
import type { ConviteDaPlataforma } from './convites-da-plataforma';

export async function lerConvitesDaPlataforma(
  tipo: 'conta' | 'equipe',
): Promise<ConviteDaPlataforma[]> {
  const supabase = await criarClientServidor();
  const [convites, equipe] = await Promise.all([
    supabase
      .from('invitations')
      .select('id, email, platform_role, expires_at, invited_by')
      .eq('kind', tipo)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
    supabase.rpc('admin_equipe'),
  ]);
  if (convites.error != null) {
    throw new Error(`Não foi possível carregar os convites: ${convites.error.message}`);
  }

  const emailDe = new Map(
    lerEquipe(equipe.data ?? []).map((pessoa) => [pessoa.userId, pessoa.email]),
  );
  return convites.data.map((convite) => ({
    id: convite.id,
    email: convite.email,
    papelNaPlataforma: convite.platform_role,
    expiraEm: convite.expires_at,
    convidadoPor: convite.invited_by == null ? null : (emailDe.get(convite.invited_by) ?? null),
  }));
}

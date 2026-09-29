/**
 * `/privacy/app/<appId>` — a política de privacidade, pelo id do app.
 *
 * O app sabe o próprio id (vem no build), e não o da loja. A tela de ajustes
 * do app (M12) abre este endereço, e ele leva à política da loja dona do app —
 * a mesma que o revisor da Apple abre pela ficha. Um endereço só por loja, e
 * não uma cópia: a política muda num lugar.
 *
 * Público, como a política: fica fora do `proxy` pelo prefixo `privacy/`.
 */
import { notFound, redirect } from 'next/navigation';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function lojaDoApp(appId: string): Promise<string | null> {
  if (!supabaseConfigurado || !serviceRoleConfigurada) return null;
  // Um id que não é uuid vira 404 sem ir ao banco: o Postgres estouraria.
  if (!UUID.test(appId)) return null;

  const { data } = await criarClientServiceRole()
    .from('apps')
    .select('store_id')
    .eq('id', appId)
    .maybeSingle();
  return data?.store_id ?? null;
}

export default async function PoliticaDoApp({
  params,
}: {
  params: Promise<{ appId: string }>;
}): Promise<never> {
  const { appId } = await params;
  const loja = await lojaDoApp(appId);
  if (loja === null) notFound();
  redirect(`/privacy/${loja}`);
}

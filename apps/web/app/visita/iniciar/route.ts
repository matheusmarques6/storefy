/**
 * `GET /visita/iniciar?convite=…` — abre a visita ao painel de um cliente.
 *
 * O convite sai da ficha do cliente no admin (A04), já auditado, e vale 5
 * minutos. Aqui ele vira o cookie da visita — mas só na sessão do MESMO admin
 * que o pediu, e só se ele continuar na equipe. Um convite vazado num log ou
 * no histórico do navegador não abre nada para mais ninguém.
 *
 * É GET porque é o destino de um redirect. A mudança que ele faz é trocar o
 * que o PRÓPRIO admin vê, e só com um convite assinado para ele: não há o que
 * forjar de fora.
 */
import { type NextResponse, type NextRequest } from 'next/server';
import { redirecionarPara } from '@/lib/redirecionar';
import { criarClientServidor } from '@/lib/supabase/server';
import { DURACAO_DA_VISITA_MS, conferirToken, criarToken } from '@/lib/visita';
import { COOKIE_LOJA_DA_VISITA, COOKIE_VISITA } from '@/lib/visita-nomes';

export const dynamic = 'force-dynamic';

export async function GET(requisicao: NextRequest): Promise<NextResponse> {
  const recusar = () => redirecionarPara('/visita/recusada');

  const convite = conferirToken(requisicao.nextUrl.searchParams.get('convite'), 'convite');
  if (convite == null) return recusar();

  const supabase = await criarClientServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id !== convite.adminId) return recusar();

  const { data: registro } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (registro == null) return recusar();

  const resposta = redirecionarPara('/');
  resposta.cookies.set(COOKIE_VISITA, criarToken('visita', convite.orgId, user.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DURACAO_DA_VISITA_MS / 1000,
  });
  // A loja escolhida numa visita anterior é de outro cliente.
  resposta.cookies.delete(COOKIE_LOJA_DA_VISITA);
  return resposta;
}

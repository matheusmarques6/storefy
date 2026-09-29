/**
 * `POST /visita/loja` — troca a loja aberta durante a visita.
 *
 * O seletor de loja do painel usa uma ação de formulário, que o proxy recusa
 * durante a visita. Trocar de loja, porém, é LER outra parte do mesmo cliente
 * — e um cliente com três lojas precisa poder ser visto nas três. A loja é
 * conferida contra a organização visitada: não há como pular para a de outro
 * cliente por aqui.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServidor } from '@/lib/supabase/server';
import { visitaDoPedido } from '@/lib/visita';
import { COOKIE_LOJA_DA_VISITA } from '@/lib/visita-nomes';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const supabase = await criarClientServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user == null) return NextResponse.json({ erro: 'sem_sessao' }, { status: 401 });

  const visita = await visitaDoPedido(supabase, user.id);
  if (visita == null) return NextResponse.json({ erro: 'sem_visita' }, { status: 403 });

  const formulario = await requisicao.formData();
  const lojaId = formulario.get('lojaId');
  if (typeof lojaId !== 'string' || lojaId === '') {
    return NextResponse.json({ erro: 'loja_invalida' }, { status: 400 });
  }

  const { data: loja, error } = await supabase
    .from('stores')
    .select('id')
    .eq('id', lojaId)
    .eq('org_id', visita.orgId)
    .maybeSingle();
  if (error != null) {
    log.erro('visita.loja-nao-lida', { falha: error });
    return NextResponse.json({ erro: 'indisponivel' }, { status: 503 });
  }
  if (loja == null) return NextResponse.json({ erro: 'loja_de_fora' }, { status: 404 });

  const resposta = NextResponse.json({ ok: true });
  resposta.cookies.set(COOKIE_LOJA_DA_VISITA, loja.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.max(1, Math.floor((visita.expiraEm - Date.now()) / 1000)),
  });
  return resposta;
}

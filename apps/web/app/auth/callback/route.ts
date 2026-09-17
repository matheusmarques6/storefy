/**
 * Callback do OAuth e dos links por e-mail.
 * Troca o `code` pela sessão e devolve o usuário ao destino.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServidor } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const proximoBruto = searchParams.get('proximo');
  // Só caminho relativo: uma URL absoluta vinda da query permitiria redirecionar
  // o usuário logado para um site externo (open redirect).
  const proximo = proximoBruto?.startsWith('/') === true ? proximoBruto : '/';

  if (code == null) {
    return NextResponse.redirect(`${origin}/entrar?erro=link-invalido`);
  }

  const supabase = await criarClientServidor();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error != null) {
    return NextResponse.redirect(`${origin}/entrar?erro=link-expirado`);
  }

  return NextResponse.redirect(`${origin}${proximo}`);
}

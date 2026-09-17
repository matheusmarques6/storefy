/**
 * Destino do link de confirmação de e-mail.
 * O Supabase envia `token_hash` e `type`; `verifyOtp` os troca pela sessão.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarClientServidor } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const tipoBruto = searchParams.get('type');

  // `type` vem da URL, então é entrada do usuário: validamos contra a lista de
  // valores aceitos em vez de fazer cast, senão um valor inesperado chegaria
  // direto ao verifyOtp.
  const TIPOS = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const;
  const tipo = TIPOS.find((valor) => valor === tipoBruto);

  if (tokenHash == null || tipo === undefined) {
    return NextResponse.redirect(`${origin}/entrar?erro=link-invalido`);
  }

  const supabase = await criarClientServidor();
  const { error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash });

  if (error != null) {
    return NextResponse.redirect(`${origin}/entrar?erro=link-expirado`);
  }

  return NextResponse.redirect(`${origin}/?email-confirmado=1`);
}

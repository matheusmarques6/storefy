/**
 * Destino dos links por e-mail que trazem `token_hash` (confirmação de
 * cadastro, troca de e-mail, definir senha).
 * `verifyOtp` troca o token pela sessão.
 *
 * O de `recovery` leva à tela de nova senha: é o link que o
 * `pnpm bootstrap:admin` imprime para a primeira pessoa da equipe definir a
 * senha — a conta dela nasce sem nenhuma.
 */
import type { NextRequest } from 'next/server';
import { criarClientServidor } from '@/lib/supabase/server';
import { redirecionarPara } from '@/lib/redirecionar';

const TIPOS = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const tipoBruto = searchParams.get('type');

  // `type` vem da URL, então é entrada do usuário: validamos contra a lista de
  // valores aceitos em vez de fazer cast, senão um valor inesperado chegaria
  // direto ao verifyOtp.
  const tipo = TIPOS.find((valor) => valor === tipoBruto);

  if (tokenHash == null || tipo === undefined) {
    return redirecionarPara('/entrar?erro=link-invalido', 302);
  }

  const supabase = await criarClientServidor();
  const { error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash });

  if (error != null) {
    return redirecionarPara('/entrar?erro=link-expirado', 302);
  }

  return redirecionarPara(tipo === 'recovery' ? '/redefinir-senha' : '/?email-confirmado=1', 302);
}

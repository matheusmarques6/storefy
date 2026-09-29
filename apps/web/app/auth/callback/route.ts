/**
 * Callback do OAuth e dos links por e-mail.
 * Troca o `code` pela sessão e devolve o usuário ao destino.
 *
 * Quando o Auth recusa ANTES de haver código — a conta nova que o banco não
 * deixou nascer, por exemplo o Google com o cadastro fechado —, ele volta
 * para cá com `error_description` em vez de `code`. A tela de login diz o que
 * houve, em vez de "link inválido".
 */
import type { NextRequest } from 'next/server';
import { criarClientServidor } from '@/lib/supabase/server';
import { configuracoesDaPlataforma } from '@/lib/configuracoes-da-plataforma-servidor';
import { redirecionarPara } from '@/lib/redirecionar';
import { log } from '@/lib/log';

/** Só caminho deste site: uma URL absoluta vinda da query seria open redirect. */
function destinoSeguro(bruto: string | null): string {
  if (
    bruto == null ||
    !bruto.startsWith('/') ||
    bruto.startsWith('//') ||
    bruto.startsWith('/\\')
  ) {
    return '/';
  }
  return bruto;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const proximo = destinoSeguro(searchParams.get('proximo'));

  if (code == null) {
    const erro = searchParams.get('error');
    const codigo = searchParams.get('error_code') ?? '';
    const descricao = searchParams.get('error_description') ?? '';
    // A conta nova que o banco recusou chega como "unexpected_failure" (a
    // conferência do cadastro fechado roda no COMMIT) ou "Database error…".
    if (
      erro != null &&
      (codigo === 'unexpected_failure' || /database error|unexpected failure/i.test(descricao))
    ) {
      log.aviso('auth.conta-nova-recusada', { codigo, descricao });
      const { cadastroAberto } = await configuracoesDaPlataforma();
      return redirecionarPara(
        `/entrar?erro=${cadastroAberto ? 'conta-nao-criada' : 'cadastro-fechado'}`,
        302,
      );
    }
    // A pessoa desistiu na tela do Google, ou o Google recusou.
    if (erro === 'access_denied') return redirecionarPara('/entrar?erro=google', 302);
    return redirecionarPara('/entrar?erro=link-invalido', 302);
  }

  const supabase = await criarClientServidor();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error != null) {
    return redirecionarPara('/entrar?erro=link-expirado', 302);
  }

  return redirecionarPara(proximo, 302);
}

'use server';

/**
 * A01c — o segundo passo da entrada no admin: o código do app autenticador.
 *
 * Quem chega aqui acertou a senha e tem o app cadastrado. A confirmação do
 * código é o que troca a sessão para `aal2` — o nível que a guarda do admin e
 * o banco (`is_platform_admin()`) exigem.
 */
import { redirect } from 'next/navigation';
import { equipeNaEntrada } from '@/lib/contexto';
import { log } from '@/lib/log';
import { codigoDigitado, mensagemDoSegundoFator } from '@/lib/segundo-fator';
import { criarClientServidor } from '@/lib/supabase/server';

export interface EstadoDaVerificacao {
  erros?: { codigo?: string };
  mensagem?: string;
  /** Cada tentativa recusada conta uma: o campo volta com o código selecionado. */
  tentativa?: number;
}

/** Recusas que falam do código, e não do caminho: a mensagem vai embaixo do campo. */
const ERROS_DO_CODIGO = new Set(['mfa_verification_failed', 'mfa_challenge_expired']);

export async function verificarCodigo(
  anterior: EstadoDaVerificacao,
  dados: FormData,
): Promise<EstadoDaVerificacao> {
  const { segundoFator } = await equipeNaEntrada();
  if (segundoFator === 'verificado') redirect('/admin');
  if (segundoFator === 'falta-ativar') redirect('/admin/ativar-2fa');

  const tentativa = (anterior.tentativa ?? 0) + 1;
  const bruto = dados.get('codigo');
  const codigo = codigoDigitado(typeof bruto === 'string' ? bruto : '');
  if (codigo === null) {
    return { erros: { codigo: 'Digite os 6 números que aparecem no app.' }, tentativa };
  }

  const supabase = await criarClientServidor();
  const { data: fatores, error: erroDaLista } = await supabase.auth.mfa.listFactors();
  if (erroDaLista != null) {
    log.erro('segundo-fator.lista', { falha: erroDaLista });
    return { mensagem: mensagemDoSegundoFator(erroDaLista.code), tentativa };
  }

  const app = fatores.totp[0];
  // O app sumiu entre abrir a tela e enviar: foi redefinido pela equipe.
  if (app === undefined) redirect('/admin/ativar-2fa');

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: app.id, code: codigo });
  if (error != null) {
    const mensagem = mensagemDoSegundoFator(error.code);
    if (error.code !== undefined && ERROS_DO_CODIGO.has(error.code)) {
      return { erros: { codigo: mensagem }, tentativa };
    }
    log.erro('segundo-fator.verificacao', { falha: error });
    return { mensagem, tentativa };
  }

  redirect('/admin');
}

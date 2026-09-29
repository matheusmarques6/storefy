'use server';

/**
 * A01b — cadastrar o app autenticador, o segundo fator da equipe.
 *
 * Quem é da equipe e ainda não tem o app chega aqui depois da senha, e só
 * entra no painel depois de ler o QR code e confirmar o primeiro código. A
 * confirmação troca a sessão para `aal2` — o nível que a guarda do admin e o
 * banco (`is_platform_admin()`) exigem — e fica na auditoria.
 */
import { redirect } from 'next/navigation';
import { equipeNaEntrada } from '@/lib/contexto';
import { log } from '@/lib/log';
import {
  codigoDigitado,
  mensagemDoSegundoFator,
  qrComoImagem,
  segredoEmGrupos,
} from '@/lib/segundo-fator';
import { ehUuid } from '@/lib/app-config-publica';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criarClientServidor } from '@/lib/supabase/server';

/** O nome que aparece no app autenticador, junto do e-mail. */
const NOME_NO_APP = 'Storefy Admin';

export type CadastroDoApp =
  { ok: true; fatorId: string; qr: string; segredo: string } | { ok: false; mensagem: string };

/** Para onde vai quem não tem mais o que cadastrar. */
async function exigirCadastroPendente(): Promise<string> {
  const { usuario, segundoFator } = await equipeNaEntrada();
  if (segundoFator === 'verificado') redirect('/admin');
  if (segundoFator === 'falta-verificar') redirect('/admin/verificar');
  return usuario.id;
}

export async function comecarCadastroDoApp(): Promise<CadastroDoApp> {
  await exigirCadastroPendente();
  const supabase = await criarClientServidor();

  /*
   * Um cadastro começado e abandonado — a página fechou antes do código —
   * fica no Auth como fator não confirmado. Ele sai antes do novo: com o mesmo
   * nome, o Auth recusaria o cadastro, e cada tentativa largada encheria o
   * limite de fatores da conta.
   */
  const { data: fatores, error: erroDaLista } = await supabase.auth.mfa.listFactors();
  if (erroDaLista != null) {
    log.erro('segundo-fator.lista', { falha: erroDaLista });
    return { ok: false, mensagem: mensagemDoSegundoFator(erroDaLista.code) };
  }
  for (const fator of fatores.all) {
    if (fator.status !== 'unverified') continue;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: fator.id });
    if (error != null) {
      log.erro('segundo-fator.limpeza', { falha: error });
      return { ok: false, mensagem: mensagemDoSegundoFator(error.code) };
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: NOME_NO_APP,
    friendlyName: NOME_NO_APP,
  });
  if (error != null) {
    log.erro('segundo-fator.cadastro', { falha: error });
    return { ok: false, mensagem: mensagemDoSegundoFator(error.code) };
  }

  return {
    ok: true,
    fatorId: data.id,
    qr: qrComoImagem(data.totp.qr_code),
    segredo: segredoEmGrupos(data.totp.secret),
  };
}

export interface EstadoDaConfirmacao {
  erros?: { codigo?: string };
  mensagem?: string;
  /** Cada tentativa recusada conta uma: o campo volta com o código selecionado. */
  tentativa?: number;
}

/** Recusas que falam do código, e não do caminho: a mensagem vai embaixo do campo. */
const ERROS_DO_CODIGO = new Set(['mfa_verification_failed', 'mfa_challenge_expired']);

export async function confirmarCadastroDoApp(
  anterior: EstadoDaConfirmacao,
  dados: FormData,
): Promise<EstadoDaConfirmacao> {
  const usuarioId = await exigirCadastroPendente();
  const tentativa = (anterior.tentativa ?? 0) + 1;

  const fator = dados.get('fator');
  const bruto = dados.get('codigo');
  const codigo = codigoDigitado(typeof bruto === 'string' ? bruto : '');
  if (codigo === null) {
    return { erros: { codigo: 'Digite os 6 números que aparecem no app.' }, tentativa };
  }
  if (typeof fator !== 'string' || !ehUuid(fator)) {
    return {
      mensagem: 'O cadastro do app se perdeu. Toque em “Gerar outro QR code” e leia de novo.',
      tentativa,
    };
  }

  const supabase = await criarClientServidor();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fator, code: codigo });
  if (error != null) {
    const mensagem = mensagemDoSegundoFator(error.code);
    if (error.code !== undefined && ERROS_DO_CODIGO.has(error.code)) {
      return { erros: { codigo: mensagem }, tentativa };
    }
    log.erro('segundo-fator.confirmacao', { falha: error });
    return { mensagem, tentativa };
  }

  // Ativar o segundo fator é mudança sensível no acesso ao painel: vai para a
  // trilha, sem cliente (org nula), como toda mudança na equipe. Se a trilha
  // falhar, o acesso já está protegido — a falha vai para o log, e a pessoa
  // entra do mesmo jeito.
  const { error: erroDaTrilha } = await criarClientServiceRole()
    .from('audit_logs')
    .insert({
      actor_id: usuarioId,
      org_id: null,
      action: 'update',
      entity: 'platform_admins',
      entity_id: usuarioId,
      diff: { segundo_fator: 'ativado' },
    });
  if (erroDaTrilha != null) log.erro('segundo-fator.auditoria', { falha: erroDaTrilha });

  redirect('/admin');
}

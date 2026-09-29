/**
 * O segundo fator da equipe da plataforma (A01), sem banco nem rede.
 *
 * Quem é da equipe enxerga todos os clientes, e por isso entra com a senha E
 * com o código do app autenticador do celular. O banco confere o mesmo
 * (`is_platform_admin()` exige a sessão `aal2`); aqui moram as decisões da
 * tela: para onde mandar a pessoa, o que aceitar como código e o que dizer
 * quando o Auth recusa.
 */

/** Onde a pessoa da equipe está no caminho até o painel. */
export type SituacaoDoSegundoFator = 'verificado' | 'falta-verificar' | 'falta-ativar';

export interface FatorDoAuth {
  factor_type: string;
  status: string;
}

/**
 * Com a sessão já confirmada pelo app, com o app cadastrado e o código por
 * digitar, ou sem app nenhum ainda.
 *
 * Sessão `aal2` sem fator confirmado é a de alguém que teve o segundo fator
 * redefinido com a sessão aberta: não vale — a pessoa cadastra o app de novo.
 */
export function situacaoDoSegundoFator(
  nivelDaSessao: string | null | undefined,
  fatores: readonly FatorDoAuth[] | null | undefined,
): SituacaoDoSegundoFator {
  const temApp = (fatores ?? []).some(
    (fator) => fator.factor_type === 'totp' && fator.status === 'verified',
  );
  if (!temApp) return 'falta-ativar';
  return nivelDaSessao === 'aal2' ? 'verificado' : 'falta-verificar';
}

/** Os seis dígitos digitados — com espaço ou traço no meio, como alguns apps mostram —, ou `null`. */
export function codigoDigitado(bruto: string): string | null {
  const digitos = bruto.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digitos) ? digitos : null;
}

/** O segredo em grupos de quatro letras: é assim que se digita no app sem se perder. */
export function segredoEmGrupos(segredo: string): string {
  return (segredo.replace(/\s/g, '').match(/.{1,4}/g) ?? []).join(' ');
}

/**
 * O QR code como endereço de imagem que o navegador lê inteiro.
 *
 * O Auth devolve o SVG cru depois de `data:image/svg+xml;utf-8,`, sem
 * codificar: um `#` de cor no meio do SVG seria lido como o começo de um
 * fragmento, e a imagem sairia cortada. Recodificado, o endereço é o mesmo
 * desenho em qualquer navegador.
 */
export function qrComoImagem(qrDoAuth: string): string {
  const virgula = qrDoAuth.indexOf(',');
  const cabecalho = virgula === -1 ? '' : qrDoAuth.slice(0, virgula);
  if (!cabecalho.startsWith('data:image/svg+xml') || cabecalho.includes(';base64')) {
    return qrDoAuth;
  }
  const svg = qrDoAuth.slice(virgula + 1);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Quando o Auth recusa: o que aconteceu, e o que fazer, sem jargão. */
export function mensagemDoSegundoFator(codigo: string | undefined): string {
  switch (codigo) {
    case 'mfa_verification_failed':
    case 'mfa_verification_rejected':
      return 'Código incorreto. Digite o código que aparece agora no app autenticador — ele muda a cada 30 segundos.';
    case 'mfa_challenge_expired':
      return 'O código venceu enquanto era digitado. Digite o código novo que aparece no app.';
    case 'over_request_rate_limit':
      return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.';
    case 'mfa_totp_enroll_not_enabled':
    case 'mfa_totp_verify_not_enabled':
      return 'A verificação em duas etapas está desligada no Supabase. Peça ao responsável técnico para ligar o app autenticador (TOTP) em Authentication > MFA.';
    case 'too_many_enrolled_mfa_factors':
      return 'Esta conta chegou ao limite de apps autenticadores. Peça a um superadmin para redefinir a sua verificação na tela Equipe.';
    case 'mfa_factor_not_found':
    case 'mfa_factor_name_conflict':
      return 'O cadastro do app autenticador mudou enquanto a página estava aberta. Recarregue a página e comece de novo.';
    case 'mfa_ip_address_mismatch':
      return 'Sua conexão mudou no meio da confirmação. Recarregue a página e tente de novo.';
    case 'session_not_found':
    case 'session_expired':
      return 'Sua sessão acabou. Entre de novo com e-mail e senha.';
    default:
      return 'Não conseguimos conferir o código agora. Tente de novo em instantes.';
  }
}

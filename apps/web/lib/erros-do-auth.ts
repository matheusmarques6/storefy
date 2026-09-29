/**
 * Os erros do Supabase Auth, em português e sem detalhe interno.
 *
 * Mora aqui, e não no arquivo de ações do login, porque o login do ADMIN
 * precisa da mesma tradução — e respondia "E-mail ou senha incorretos." para
 * QUALQUER falha, inclusive limite de tentativas e servidor fora do ar, que
 * mandavam a pessoa conferir uma senha que estava certa.
 */
import { FALHA_GENERICA, mensagemDaFalha } from '@/lib/erros';

/**
 * Traduz os erros do Supabase Auth.
 *
 * As mensagens originais chegam em inglês e às vezes expõem detalhe interno.
 * Para credencial inválida devolvemos sempre o mesmo texto, sem dizer se foi o
 * e-mail ou a senha: distinguir permitiria descobrir quais e-mails têm conta.
 */
export function traduzirErroAuth(codigo: string | undefined, mensagem: string): string {
  switch (codigo) {
    case 'invalid_credentials':
      return 'E-mail ou senha incorretos.';
    case 'email_not_confirmed':
      return 'Confirme seu e-mail antes de entrar. Procure a mensagem que enviamos na sua caixa de entrada.';
    case 'user_already_exists':
    case 'email_exists':
      return 'Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.';
    case 'weak_password':
      return 'Senha muito fraca. Use pelo menos 8 caracteres, misturando letras e números.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
    case 'same_password':
      return 'A nova senha precisa ser diferente da atual.';
    default:
      // O texto original do Auth é inglês e técnico: fica no log.
      return mensagemDaFalha('auth', { code: codigo, message: mensagem }, FALHA_GENERICA);
  }
}

'use server';

/** Server Actions de autenticação — tela C01. */
import { redirect } from 'next/navigation';
import { criarClientServidor } from '@/lib/supabase/server';
import { urlDoSite } from '@/lib/env';
import {
  cadastroSchema,
  extrairErros,
  loginSchema,
  recuperarSenhaSchema,
  redefinirSenhaSchema,
  type ErrosDeCampo,
} from '@/lib/validacao';

export interface EstadoFormulario {
  erros?: ErrosDeCampo;
  mensagem?: string;
  sucesso?: boolean;
}

/**
 * Traduz os erros do Supabase Auth.
 *
 * As mensagens originais chegam em inglês e às vezes expõem detalhe interno.
 * Para credencial inválida devolvemos sempre o mesmo texto, sem dizer se foi o
 * e-mail ou a senha: distinguir permitiria descobrir quais e-mails têm conta.
 */
function traduzirErroAuth(codigo: string | undefined, mensagem: string): string {
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
      return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
    case 'same_password':
      return 'A nova senha precisa ser diferente da atual.';
    default:
      return mensagem !== '' ? mensagem : 'Não foi possível concluir. Tente novamente.';
  }
}

export async function entrar(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const analise = loginSchema.safeParse({
    email: dados.get('email'),
    senha: dados.get('senha'),
  });
  if (!analise.success) return { erros: extrairErros(analise.error) };

  const supabase = await criarClientServidor();
  const { error } = await supabase.auth.signInWithPassword({
    email: analise.data.email,
    password: analise.data.senha,
  });

  if (error != null) {
    return { mensagem: traduzirErroAuth(error.code, error.message) };
  }

  const proximo = dados.get('proximo');
  redirect(typeof proximo === 'string' && proximo.startsWith('/') ? proximo : '/');
}

export async function cadastrar(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const analise = cadastroSchema.safeParse({
    nomeEmpresa: dados.get('nomeEmpresa'),
    email: dados.get('email'),
    senha: dados.get('senha'),
  });
  if (!analise.success) return { erros: extrairErros(analise.error) };

  const supabase = await criarClientServidor();
  const { data, error } = await supabase.auth.signUp({
    email: analise.data.email,
    password: analise.data.senha,
    options: {
      // O trigger handle_new_user lê company_name para nomear a organização.
      data: { company_name: analise.data.nomeEmpresa },
      emailRedirectTo: `${urlDoSite()}/auth/confirmar`,
    },
  });

  if (error != null) {
    return { mensagem: traduzirErroAuth(error.code, error.message) };
  }

  // Sessão já ativa: a confirmação de e-mail está desligada no projeto.
  if (data.session != null) redirect('/');

  redirect(`/confirmar-email?email=${encodeURIComponent(analise.data.email)}`);
}

export async function sair(): Promise<void> {
  const supabase = await criarClientServidor();
  await supabase.auth.signOut();
  redirect('/entrar');
}

export async function pedirRecuperacao(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const analise = recuperarSenhaSchema.safeParse({ email: dados.get('email') });
  if (!analise.success) return { erros: extrairErros(analise.error) };

  const supabase = await criarClientServidor();
  const { error } = await supabase.auth.resetPasswordForEmail(analise.data.email, {
    redirectTo: `${urlDoSite()}/auth/callback?proximo=/redefinir-senha`,
  });

  // Resposta idêntica com ou sem conta: dizer "e-mail não cadastrado" revelaria
  // quem tem conta na plataforma.
  if (error?.code === 'over_email_send_rate_limit') {
    return { mensagem: traduzirErroAuth(error.code, error.message) };
  }

  return {
    sucesso: true,
    mensagem:
      'Se existir uma conta com este e-mail, enviamos um link para redefinir a senha. O link vale por 1 hora.',
  };
}

export async function redefinirSenha(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const analise = redefinirSenhaSchema.safeParse({
    senha: dados.get('senha'),
    confirmacao: dados.get('confirmacao'),
  });
  if (!analise.success) return { erros: extrairErros(analise.error) };

  const supabase = await criarClientServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user == null) {
    return {
      mensagem: 'Seu link expirou. Peça um novo link de recuperação para continuar.',
    };
  }

  const { error } = await supabase.auth.updateUser({ password: analise.data.senha });
  if (error != null) {
    return { mensagem: traduzirErroAuth(error.code, error.message) };
  }

  redirect('/?senha-alterada=1');
}

/** Início do fluxo OAuth do Google. Só habilitado quando o provedor existe. */
export async function entrarComGoogle(): Promise<void> {
  const supabase = await criarClientServidor();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${urlDoSite()}/auth/callback` },
  });

  if (error != null || data.url === '') {
    redirect('/entrar?erro=google');
  }
  redirect(data.url);
}

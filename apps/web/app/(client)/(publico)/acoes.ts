'use server';

/** Server Actions de autenticação — tela C01. */
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { COOKIE_LOJA_DA_VISITA, COOKIE_VISITA } from '@/lib/visita-nomes';
import { criarClientServidor } from '@/lib/supabase/server';
import { urlDoSite } from '@/lib/env';
import { traduzirErroAuth } from '@/lib/erros-do-auth';
import {
  cadastroSchema,
  extrairErros,
  loginSchema,
  recuperarSenhaSchema,
  redefinirSenhaSchema,
  valoresDigitados,
  type ErrosDeCampo,
  type ValoresDigitados,
} from '@/lib/validacao';

export interface EstadoFormulario {
  erros?: ErrosDeCampo;
  mensagem?: string;
  sucesso?: boolean;
  /** O que foi digitado, menos a senha: o formulário não se apaga no erro. */
  valores?: ValoresDigitados;
}

export async function entrar(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const valores = valoresDigitados(dados, ['email']);
  const analise = loginSchema.safeParse({
    email: dados.get('email'),
    senha: dados.get('senha'),
  });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };

  const supabase = await criarClientServidor();
  const { error } = await supabase.auth.signInWithPassword({
    email: analise.data.email,
    password: analise.data.senha,
  });

  if (error != null) {
    return { mensagem: traduzirErroAuth(error.code, error.message), valores };
  }

  const proximo = dados.get('proximo');
  redirect(typeof proximo === 'string' && proximo.startsWith('/') ? proximo : '/');
}

export async function cadastrar(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const valores = valoresDigitados(dados, ['nomeEmpresa', 'email']);
  const analise = cadastroSchema.safeParse({
    nomeEmpresa: dados.get('nomeEmpresa'),
    email: dados.get('email'),
    senha: dados.get('senha'),
  });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };

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
    return { mensagem: traduzirErroAuth(error.code, error.message), valores };
  }

  // Sessão já ativa: a confirmação de e-mail está desligada no projeto.
  if (data.session != null) redirect('/');

  redirect(`/confirmar-email?email=${encodeURIComponent(analise.data.email)}`);
}

export async function sair(): Promise<void> {
  const supabase = await criarClientServidor();
  await supabase.auth.signOut();

  // Uma visita ao painel de cliente aberta não sobrevive à saída da conta: o
  // próximo a entrar neste navegador não pode herdá-la.
  const armazem = await cookies();
  armazem.delete(COOKIE_VISITA);
  armazem.delete(COOKIE_LOJA_DA_VISITA);

  redirect('/entrar');
}

export async function pedirRecuperacao(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const valores = valoresDigitados(dados, ['email']);
  const analise = recuperarSenhaSchema.safeParse({ email: dados.get('email') });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };

  const supabase = await criarClientServidor();
  const { error } = await supabase.auth.resetPasswordForEmail(analise.data.email, {
    redirectTo: `${urlDoSite()}/auth/callback?proximo=/redefinir-senha`,
  });

  // Resposta idêntica com ou sem conta: dizer "e-mail não cadastrado" revelaria
  // quem tem conta na plataforma.
  if (error?.code === 'over_email_send_rate_limit') {
    return { mensagem: traduzirErroAuth(error.code, error.message), valores };
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

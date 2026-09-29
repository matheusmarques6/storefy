'use server';

/** Configurações da organização e da conta do usuário. */
import { revalidatePath } from 'next/cache';
import {
  contaSchema,
  extrairErros,
  organizacaoSchema,
  trocarEmailSchema,
  trocarSenhaSchema,
  valoresDigitados,
  type ErrosDeCampo,
  type ValoresDigitados,
} from '@/lib/validacao';
import { criarClientServidor } from '@/lib/supabase/server';
import { exigirContextoCliente } from '@/lib/contexto';
import { urlDoSite } from '@/lib/env';
import { mensagemDaFalha } from '@/lib/erros';

export interface EstadoConfig {
  erros?: ErrosDeCampo;
  mensagem?: string;
  sucesso?: boolean;
  /** O que foi digitado (nunca senha), para o formulário não se apagar. */
  valores?: ValoresDigitados;
}

export async function salvarOrganizacao(
  _anterior: EstadoConfig,
  dados: FormData,
): Promise<EstadoConfig> {
  const valores = valoresDigitados(dados, ['nome']);
  const analise = organizacaoSchema.safeParse({ nome: dados.get('nome') });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };

  const { organizacao } = await exigirContextoCliente();
  const supabase = await criarClientServidor();

  const { data: atualizada, error } = await supabase
    .from('organizations')
    .update({ name: analise.data.nome })
    .eq('id', organizacao.id)
    .select('id')
    .maybeSingle();

  if (error != null) {
    return {
      mensagem: mensagemDaFalha(
        'configuracoes',
        error,
        'Não foi possível salvar agora. Tente de novo em instantes.',
      ),
      valores,
    };
  }
  if (atualizada == null) {
    return {
      mensagem:
        'Você não tem permissão para alterar os dados da empresa. Apenas proprietários e administradores podem.',
      valores,
    };
  }

  revalidatePath('/', 'layout');
  return { sucesso: true, mensagem: 'Dados da empresa atualizados.', valores };
}

export async function salvarConta(_anterior: EstadoConfig, dados: FormData): Promise<EstadoConfig> {
  const valores = valoresDigitados(dados, ['nome']);
  const analise = contaSchema.safeParse({ nome: dados.get('nome') });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };

  const supabase = await criarClientServidor();
  const { error } = await supabase.auth.updateUser({
    data: { full_name: analise.data.nome },
  });

  if (error != null) {
    return {
      mensagem: mensagemDaFalha(
        'configuracoes',
        error,
        'Não foi possível salvar agora. Tente de novo em instantes.',
      ),
      valores,
    };
  }

  revalidatePath('/', 'layout');
  return { sucesso: true, mensagem: 'Nome atualizado.', valores };
}

export async function trocarEmail(_anterior: EstadoConfig, dados: FormData): Promise<EstadoConfig> {
  const valores = valoresDigitados(dados, ['email']);
  const analise = trocarEmailSchema.safeParse({ email: dados.get('email') });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };

  const supabase = await criarClientServidor();
  const { error } = await supabase.auth.updateUser(
    { email: analise.data.email },
    { emailRedirectTo: `${urlDoSite()}/auth/confirmar` },
  );

  if (error != null) {
    if (error.code === 'email_exists') {
      return { mensagem: 'Este e-mail já está em uso por outra conta.', valores };
    }
    if (error.code === 'over_email_send_rate_limit') {
      return {
        mensagem: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
        valores,
      };
    }
    return {
      mensagem: mensagemDaFalha(
        'configuracoes',
        error,
        'Não foi possível trocar o e-mail agora. Tente de novo em instantes.',
      ),
      valores,
    };
  }

  return {
    sucesso: true,
    mensagem:
      'Enviamos um link de confirmação para o novo e-mail. A troca só vale depois que você clicar nele.',
    valores,
  };
}

export async function trocarSenha(_anterior: EstadoConfig, dados: FormData): Promise<EstadoConfig> {
  const analise = trocarSenhaSchema.safeParse({
    senhaAtual: dados.get('senhaAtual'),
    senha: dados.get('senha'),
    confirmacao: dados.get('confirmacao'),
  });
  if (!analise.success) return { erros: extrairErros(analise.error) };

  const supabase = await criarClientServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email == null) {
    return { mensagem: 'Sessão expirada. Entre novamente para trocar a senha.' };
  }

  // Reautentica antes de trocar: sem isso, quem pegasse uma sessão aberta
  // conseguiria mudar a senha e tomar a conta.
  const { error: erroSenhaAtual } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: analise.data.senhaAtual,
  });
  if (erroSenhaAtual != null) {
    return { erros: { senhaAtual: 'Senha atual incorreta.' } };
  }

  const { error } = await supabase.auth.updateUser({ password: analise.data.senha });
  if (error != null) {
    if (error.code === 'same_password') {
      return { erros: { senha: 'A nova senha precisa ser diferente da atual.' } };
    }
    if (error.code === 'weak_password') {
      return {
        erros: {
          senha: 'Senha muito fraca. Use pelo menos 8 caracteres, misturando letras e números.',
        },
      };
    }
    return {
      mensagem: mensagemDaFalha(
        'configuracoes',
        error,
        'Não foi possível trocar a senha agora. Tente de novo em instantes.',
      ),
    };
  }

  return { sucesso: true, mensagem: 'Senha alterada.' };
}

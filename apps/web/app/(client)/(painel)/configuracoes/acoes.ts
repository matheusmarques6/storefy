'use server';

/** Configurações da organização e da conta do usuário. */
import { revalidatePath } from 'next/cache';
import { podeEscrever } from '@storefy/db';
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

export interface EstadoDosAvisos {
  ok?: boolean;
  mensagem?: string;
  /** O que foi ENVIADO nas caixas de marcar, para elas não voltarem atrás. */
  revisaoDoApp?: boolean;
  respostaDoSuporte?: boolean;
}

/**
 * C16 — os avisos por e-mail de QUEM PEDE, nesta empresa. Cada um só mexe na
 * própria escolha (a RLS garante), e sem linha o padrão é receber tudo.
 *
 * Grava lendo antes em vez de `upsert`: o `upsert` do PostgREST reescreve as
 * colunas da chave no conflito, e a pessoa só tem permissão de mudar as duas
 * escolhas — não a empresa nem o dono da linha.
 */
export async function salvarAvisos(
  _anterior: EstadoDosAvisos,
  dados: FormData,
): Promise<EstadoDosAvisos> {
  const { organizacao, usuario, papel, visita } = await exigirContextoCliente();
  // A caixa da revisão chega DESLIGADA para quem não recebe esse aviso, e o
  // navegador não envia caixa desligada: lê-la como "desmarcada" gravaria uma
  // escolha que a pessoa nunca fez — e que valeria no dia em que ela virasse
  // administradora. Para essa pessoa, a escolha da revisão fica como está.
  const revisaoDoApp = podeEscrever(papel) ? dados.get('revisaoDoApp') === 'on' : undefined;
  const respostaDoSuporte = dados.get('respostaDoSuporte') === 'on';
  const devolvido = { revisaoDoApp, respostaDoSuporte };

  if (visita != null) {
    return { mensagem: 'Durante a visita ao painel de um cliente, nada muda.', ...devolvido };
  }

  const supabase = await criarClientServidor();
  const { data: atual } = await supabase
    .from('email_preferences')
    .select('user_id')
    .eq('org_id', organizacao.id)
    .eq('user_id', usuario.id)
    .maybeSingle();

  const campos = {
    resposta_do_suporte: respostaDoSuporte,
    ...(revisaoDoApp === undefined ? {} : { revisao_do_app: revisaoDoApp }),
  };
  const { error } =
    atual == null
      ? await supabase
          .from('email_preferences')
          .insert({ org_id: organizacao.id, user_id: usuario.id, ...campos })
      : await supabase
          .from('email_preferences')
          .update(campos)
          .eq('org_id', organizacao.id)
          .eq('user_id', usuario.id);

  if (error != null) {
    return {
      mensagem: mensagemDaFalha('configuracoes', error, 'Não conseguimos salvar. Tente de novo.'),
      ...devolvido,
    };
  }

  revalidatePath('/configuracoes');
  return { ok: true, mensagem: 'Avisos salvos.', ...devolvido };
}

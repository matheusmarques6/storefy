'use server';

/**
 * O convite, do lado de quem recebeu: aceitar com a conta que já existe,
 * criar a conta pelo link, ou sair da conta errada para entrar com a certa.
 *
 * Nada aqui confia no que a tela mostrou: o banco confere o convite de novo
 * em cada ação (`aceitar_convite`, e o `handle_new_user` no cadastro).
 */
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { criarClientServidor } from '@/lib/supabase/server';
import { definirEmpresaAtiva } from '@/lib/contexto';
import { urlDoSite } from '@/lib/env';
import { traduzirErroAuth } from '@/lib/erros-do-auth';
import { mensagemDaFalha } from '@/lib/erros';
import {
  aceiteDeuCerto,
  cadastroDeLojistaPeloConviteSchema,
  cadastroPeloConviteSchema,
  mensagemDoAceite,
  resultadoDoAceite,
  segredoTemFormato,
  situacaoDoConvite,
} from '@/lib/convites';
import { COOKIE_LOJA_DA_VISITA, COOKIE_VISITA } from '@/lib/visita-nomes';
import {
  extrairErros,
  valoresDigitados,
  type ErrosDeCampo,
  type ValoresDigitados,
} from '@/lib/validacao';

export interface EstadoDoConvite {
  ok?: boolean;
  mensagem?: string;
  erros?: ErrosDeCampo;
  valores?: ValoresDigitados;
  /** Para onde ir depois de aceitar. A página inteira recarrega: a empresa ativa mudou. */
  destino?: string;
}

/** Depois de entrar na equipe da Storefy, o lugar dela é o admin. */
function destinoDoTipo(tipo: string | null | undefined): string {
  return tipo === 'equipe' ? '/admin' : '/';
}

export async function aceitarConvite(token: string): Promise<EstadoDoConvite> {
  if (!segredoTemFormato(token)) return { mensagem: mensagemDoAceite('inexistente') };

  const supabase = await criarClientServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user == null) return { mensagem: 'Entre na sua conta para aceitar o convite.' };

  const { data, error } = await supabase.rpc('aceitar_convite', { p_token: token });
  if (error != null) {
    return {
      mensagem: mensagemDaFalha(
        'convite',
        error,
        'Não conseguimos aceitar o convite. Tente de novo.',
      ),
    };
  }

  const linha = data[0];
  const resultado = resultadoDoAceite(linha?.resultado);
  if (!aceiteDeuCerto(resultado)) return { mensagem: mensagemDoAceite(resultado) };

  // Quem acabou de entrar numa empresa quer ver ESSA empresa.
  if (linha?.tipo === 'organizacao' && linha.organizacao != null) {
    await definirEmpresaAtiva(linha.organizacao);
  }
  return { ok: true, mensagem: mensagemDoAceite(resultado), destino: destinoDoTipo(linha?.tipo) };
}

export async function cadastrarPeloConvite(
  token: string,
  _anterior: EstadoDoConvite,
  dados: FormData,
): Promise<EstadoDoConvite> {
  const valores = valoresDigitados(dados, ['nome', 'nomeEmpresa']);
  if (!segredoTemFormato(token)) return { mensagem: mensagemDoAceite('inexistente'), valores };

  const supabase = await criarClientServidor();
  const { data: linhas } = await supabase.rpc('ver_convite', { p_token: token });
  const convite = linhas?.[0];
  const situacao = situacaoDoConvite(convite?.situacao);
  if (situacao !== 'pendente' || convite?.email == null) {
    return {
      mensagem: mensagemDoAceite(situacao === 'pendente' ? 'inexistente' : situacao),
      valores,
    };
  }
  if (convite.ja_tem_conta === true) {
    return {
      mensagem: `Já existe uma conta com ${convite.email}. Entre com ela para aceitar o convite.`,
      valores,
    };
  }

  const ehLojista = convite.tipo === 'conta';
  const analise = (
    ehLojista ? cadastroDeLojistaPeloConviteSchema : cadastroPeloConviteSchema
  ).safeParse({
    nome: dados.get('nome'),
    senha: dados.get('senha'),
    ...(ehLojista ? { nomeEmpresa: dados.get('nomeEmpresa') } : {}),
  });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };

  const nomeEmpresa = 'nomeEmpresa' in analise.data ? analise.data.nomeEmpresa : null;
  const { data, error } = await supabase.auth.signUp({
    email: convite.email,
    password: analise.data.senha,
    options: {
      data: {
        full_name: analise.data.nome,
        // O `handle_new_user` lê o convite daqui e confere tudo de novo.
        convite: token,
        ...(nomeEmpresa === null ? {} : { company_name: nomeEmpresa }),
      },
      emailRedirectTo: `${urlDoSite()}/auth/confirmar`,
    },
  });

  if (error != null) {
    /*
     * O banco recusou a conta: o convite venceu, foi cancelado ou usado entre
     * abrir a tela e enviar. O Auth devolve só "Database error saving new
     * user"; perguntar de novo pelo convite diz o que houve.
     */
    const { data: depois } = await supabase.rpc('ver_convite', { p_token: token });
    const agora = situacaoDoConvite(depois?.[0]?.situacao);
    if (agora !== 'pendente') return { mensagem: mensagemDoAceite(agora), valores };
    return { mensagem: traduzirErroAuth(error.code, error.message), valores };
  }

  // Confirmação de e-mail desligada no projeto: a sessão já existe.
  if (data.session != null) {
    const { data: vinculo } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('user_id', data.session.user.id)
      .limit(1)
      .maybeSingle();
    if (vinculo != null) await definirEmpresaAtiva(vinculo.org_id);
    redirect(destinoDoTipo(convite.tipo));
  }

  redirect(`/confirmar-email?email=${encodeURIComponent(convite.email)}`);
}

/**
 * O convite é para outro e-mail: sai da conta atual e volta ao convite, que
 * então oferece criar a conta ou entrar com a certa.
 */
export async function sairParaTrocarDeConta(token: string): Promise<EstadoDoConvite> {
  const supabase = await criarClientServidor();
  await supabase.auth.signOut();

  const armazem = await cookies();
  armazem.delete(COOKIE_VISITA);
  armazem.delete(COOKIE_LOJA_DA_VISITA);

  return {
    ok: true,
    destino: segredoTemFormato(token) ? `/convite/${token}` : '/entrar',
  };
}

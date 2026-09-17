'use server';

/**
 * CRUD de lojas.
 *
 * Toda ação repassa a operação ao Supabase com a sessão do usuário, então a RLS
 * decide o que pode. As checagens de papel aqui servem para dar uma mensagem
 * melhor que "permissão negada" — não são a autorização em si (regra 2).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { extrairErros, lojaSchema, type ErrosDeCampo } from '@/lib/validacao';
import { criarClientServidor } from '@/lib/supabase/server';
import { COOKIE_LOJA, exigirContextoCliente } from '@/lib/contexto';

export interface EstadoLoja {
  erros?: ErrosDeCampo;
  mensagem?: string;
}

/** A URL é única por organização; o banco tem o índice que garante isso. */
function traduzirErroBanco(codigo: string, mensagem: string): string {
  if (codigo === '23505') {
    return 'Já existe uma loja com este endereço na sua empresa.';
  }
  if (codigo === '42501' || codigo === 'PGRST301') {
    return 'Você não tem permissão para esta ação. Fale com o proprietário da empresa.';
  }
  return mensagem !== '' ? mensagem : 'Não foi possível salvar. Tente novamente.';
}

export async function criarLoja(_anterior: EstadoLoja, dados: FormData): Promise<EstadoLoja> {
  const analise = lojaSchema.safeParse({ nome: dados.get('nome'), url: dados.get('url') });
  if (!analise.success) return { erros: extrairErros(analise.error) };

  const { organizacao } = await exigirContextoCliente();
  const supabase = await criarClientServidor();

  const { data: criada, error } = await supabase
    .from('stores')
    .insert({
      org_id: organizacao.id,
      name: analise.data.nome,
      primary_url: analise.data.url,
      shop_domain: new URL(analise.data.url).hostname,
    })
    .select('id')
    .single();

  if (error != null) {
    return { mensagem: traduzirErroBanco(error.code, error.message) };
  }

  // A loja recém-criada vira a ativa: é o que o usuário espera depois de criar.
  const armazem = await cookies();
  armazem.set(COOKIE_LOJA, criada.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath('/', 'layout');
  redirect(`/lojas/${criada.id}?criada=1`);
}

export async function editarLoja(
  lojaId: string,
  _anterior: EstadoLoja,
  dados: FormData,
): Promise<EstadoLoja> {
  const analise = lojaSchema.safeParse({ nome: dados.get('nome'), url: dados.get('url') });
  if (!analise.success) return { erros: extrairErros(analise.error) };

  const supabase = await criarClientServidor();
  const { data: atualizada, error } = await supabase
    .from('stores')
    .update({
      name: analise.data.nome,
      primary_url: analise.data.url,
      shop_domain: new URL(analise.data.url).hostname,
    })
    .eq('id', lojaId)
    .select('id')
    .maybeSingle();

  if (error != null) {
    return { mensagem: traduzirErroBanco(error.code, error.message) };
  }
  // Sem erro e sem linha: a RLS filtrou o UPDATE (papel insuficiente).
  if (atualizada == null) {
    return {
      mensagem:
        'Você não tem permissão para editar esta loja. Apenas proprietários e administradores podem.',
    };
  }

  revalidatePath('/', 'layout');
  redirect(`/lojas/${lojaId}?salva=1`);
}

export async function excluirLoja(lojaId: string): Promise<void> {
  const supabase = await criarClientServidor();
  const { data: removida, error } = await supabase
    .from('stores')
    .delete()
    .eq('id', lojaId)
    .select('id')
    .maybeSingle();

  if (error != null) {
    throw new Error(traduzirErroBanco(error.code, error.message));
  }
  if (removida == null) {
    throw new Error('Apenas o proprietário da empresa pode excluir uma loja.');
  }

  // O cookie apontava para a loja que acabou de sumir.
  const armazem = await cookies();
  if (armazem.get(COOKIE_LOJA)?.value === lojaId) {
    armazem.delete(COOKIE_LOJA);
  }

  revalidatePath('/', 'layout');
  redirect('/lojas?excluida=1');
}

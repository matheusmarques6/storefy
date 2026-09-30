'use server';

/** Login do painel admin (A01). */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { criarClientServidor } from '@/lib/supabase/server';
import { COOKIE_LOJA_DA_VISITA, COOKIE_VISITA } from '@/lib/visita-nomes';
import { traduzirErroAuth } from '@/lib/erros-do-auth';
import {
  extrairErros,
  loginSchema,
  valoresDigitados,
  type ErrosDeCampo,
  type ValoresDigitados,
} from '@/lib/validacao';
import { log } from '@/lib/log';

export interface EstadoAdmin {
  erros?: ErrosDeCampo;
  mensagem?: string;
  /** O e-mail digitado, para o formulário não se apagar no erro. */
  valores?: ValoresDigitados;
}

export async function entrarAdmin(_anterior: EstadoAdmin, dados: FormData): Promise<EstadoAdmin> {
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

  // A sessão está criada, mas só com a senha. A guarda confere platform_admins
  // (quem não é da equipe vai para /admin/sem-acesso) e o segundo fator: quem
  // tem o app autenticador vai digitar o código; quem não tem, cadastrar.
  // Autenticar não é autorizar.
  redirect('/admin');
}

/**
 * Sai da conta pelas telas do segundo fator e volta ao login do ADMIN — é
 * dali que se entra com outra conta da equipe. A visita a um cliente, se
 * houver, acaba junto: o próximo a entrar neste navegador não a herda.
 */
export async function sairDoAdmin(): Promise<void> {
  const supabase = await criarClientServidor();
  const { error: erroAoSair } = await supabase.auth.signOut();
  // A sessão sai deste navegador mesmo assim (o supabase-js apaga o cookie); o
  // que falhou foi derrubá-la no servidor, e isso precisa aparecer no log.
  if (erroAoSair != null) log.aviso('admin.saida-sem-revogar', { falha: erroAoSair });

  const armazem = await cookies();
  armazem.delete(COOKIE_VISITA);
  armazem.delete(COOKIE_LOJA_DA_VISITA);

  redirect('/admin/entrar');
}

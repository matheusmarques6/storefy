'use server';

/** Login do painel admin (A01). */
import { redirect } from 'next/navigation';
import { criarClientServidor } from '@/lib/supabase/server';
import { traduzirErroAuth } from '@/lib/erros-do-auth';
import {
  extrairErros,
  loginSchema,
  valoresDigitados,
  type ErrosDeCampo,
  type ValoresDigitados,
} from '@/lib/validacao';

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

  // A sessão está criada; a guarda do layout confere platform_admins e manda
  // para /admin/sem-acesso quem não é da equipe. Autenticar não é autorizar.
  redirect('/admin');
}

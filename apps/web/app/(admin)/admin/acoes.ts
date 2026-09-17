'use server';

/** Login do painel admin (A01). */
import { redirect } from 'next/navigation';
import { criarClientServidor } from '@/lib/supabase/server';
import { extrairErros, loginSchema, type ErrosDeCampo } from '@/lib/validacao';

export interface EstadoAdmin {
  erros?: ErrosDeCampo;
  mensagem?: string;
}

export async function entrarAdmin(_anterior: EstadoAdmin, dados: FormData): Promise<EstadoAdmin> {
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
    return { mensagem: 'E-mail ou senha incorretos.' };
  }

  // A sessão está criada; a guarda do layout confere platform_admins e manda
  // para /admin/sem-acesso quem não é da equipe. Autenticar não é autorizar.
  redirect('/admin');
}

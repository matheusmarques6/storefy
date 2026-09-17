/**
 * Renovação da sessão no middleware.
 *
 * O token do Supabase expira; sem esta passagem, o usuário seria deslogado em
 * qualquer navegação após a expiração. `getUser()` renova e reescreve os
 * cookies na resposta.
 */
import { createServerClient } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';
import type { Database } from '@storefy/db';
import { env } from '@/lib/env';

export async function carregarUsuario(request: NextRequest, response: NextResponse) {
  const supabase = createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(paraDefinir) {
        for (const { name, value, options } of paraDefinir) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Precisa ser getUser(), não getSession(): só o getUser valida o token no
  // servidor do Supabase. getSession confia no cookie, que o cliente controla.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

import 'server-only';

/**
 * Client do Supabase para Server Components, Server Actions e Route Handlers.
 * Carrega a sessão dos cookies, então toda query roda como o usuário logado e
 * passa pela RLS.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@storefy/db';
import { env } from '@/lib/env';

export async function criarClientServidor() {
  const armazemCookies = await cookies();

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return armazemCookies.getAll();
      },
      setAll(paraDefinir) {
        try {
          for (const { name, value, options } of paraDefinir) {
            armazemCookies.set(name, value, options);
          }
        } catch {
          // Server Components não podem escrever cookies. O middleware já
          // renova a sessão a cada request, então ignorar aqui é seguro —
          // é o padrão recomendado pelo @supabase/ssr.
        }
      },
    },
  });
}

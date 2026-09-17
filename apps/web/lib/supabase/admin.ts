import 'server-only';

/**
 * Client com service role: IGNORA RLS.
 *
 * Regra 2 do CLAUDE.md: só pode ser usado em Server Actions e Route Handlers
 * que já validaram `platform_admins`. Nunca importe isto em Client Component —
 * o `server-only` acima transforma essa tentativa em erro de build.
 *
 * Prefira `criarClientServidor()` sempre que a RLS já resolver o caso: o painel
 * admin lê organizações e lojas pelas policies, que já contemplam
 * `is_platform_admin()`. A service role fica para o que a RLS bloqueia de
 * propósito, como escrever em `platform_admins`.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { chaveServiceRole, env } from '@/lib/env';

export function criarClientServiceRole() {
  return createClient<Database>(env.supabaseUrl, chaveServiceRole(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

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

/** O cabeçalho em que o servidor declara quem pediu a escrita (migration 70). */
export const CABECALHO_DO_AUTOR = 'x-storefy-ator';

/**
 * `ator`: quem pediu a escrita, já conferido pela ação. Vai num cabeçalho que
 * o gatilho da trilha lê só da service role — sem ele, o que o lojista faz
 * pelo servidor (a imagem do app, as contas Apple e Google, a Shopify) ficava
 * na auditoria como "o sistema". Jobs e webhooks não têm ator: não passam.
 */
export function criarClientServiceRole(opcoes: { ator?: string } = {}) {
  return createClient<Database>(env.supabaseUrl, chaveServiceRole(), {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(opcoes.ator === undefined
      ? {}
      : { global: { headers: { [CABECALHO_DO_AUTOR]: opcoes.ator } } }),
  });
}

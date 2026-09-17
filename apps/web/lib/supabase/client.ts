'use client';

/** Client do Supabase para o browser. Usa apenas a chave anônima. */
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@storefy/db';
import { env } from '@/lib/env';

export function criarClientBrowser() {
  return createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey);
}

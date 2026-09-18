/**
 * Verificação de saúde do deploy.
 *
 * Existe para responder, sem adivinhação, a pergunta que aparece assim que a
 * aplicação sobe em um ambiente novo: ela está configurada e enxerga o banco?
 * Sem isto, um deploy com variável faltando só se manifesta como a tela de
 * "Configuração pendente", sem dizer se o problema é a chave, a URL ou a rede.
 *
 * O que é exposto aqui é deliberadamente pobre: apenas booleanos dizendo se
 * cada variável existe, nunca o valor. Saber que uma chave está ausente não
 * ajuda um atacante; saber qual é ela, sim.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { env, supabaseConfigurado } from '@/lib/env';

// Sempre dinâmica: o valor tem que refletir o ambiente agora, não o do build.
export const dynamic = 'force-dynamic';

interface Saude {
  status: 'ok' | 'degradado' | 'nao_configurado';
  verificadoEm: string;
  configuracao: Record<string, boolean>;
  banco: { alcancavel: boolean; latenciaMs: number | null; erro?: string };
}

function temValor(variavel: string | undefined): boolean {
  return variavel != null && variavel !== '';
}

export async function GET() {
  const configuracao = {
    supabaseUrl: temValor(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: temValor(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    // Necessária para o painel admin e para `pnpm bootstrap:admin`.
    supabaseServiceRole: temValor(process.env.SUPABASE_SERVICE_ROLE_KEY),
    // Sem ela, os links de confirmação de e-mail apontam para o domínio do
    // deploy atual, que muda a cada preview.
    siteUrl: temValor(process.env.NEXT_PUBLIC_SITE_URL),
    googleOAuth: env.googleHabilitado,
    dominioProprioCliente: temValor(process.env.NEXT_PUBLIC_CLIENT_HOST),
    dominioProprioAdmin: temValor(process.env.NEXT_PUBLIC_ADMIN_HOST),
  };

  if (!supabaseConfigurado) {
    const corpo: Saude = {
      status: 'nao_configurado',
      verificadoEm: new Date().toISOString(),
      configuracao,
      banco: { alcancavel: false, latenciaMs: null, erro: 'Supabase não configurado.' },
    };
    return NextResponse.json(corpo, { status: 503, headers: { 'cache-control': 'no-store' } });
  }

  const inicio = Date.now();
  let alcancavel = false;
  let erro: string | undefined;

  try {
    // Consulta trivial e barata: só confirma que a API responde e que a RLS
    // está ativa. Como é a chave anônima e não há sessão, nenhuma policy
    // libera linha — contar zero é o resultado certo e prova o caminho todo.
    const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase
      .from('organizations')
      .select('id', { head: true, count: 'exact' });

    if (error == null) {
      alcancavel = true;
    } else {
      erro = error.message;
    }
  } catch (problema: unknown) {
    erro = problema instanceof Error ? problema.message : 'Falha ao consultar o banco.';
  }

  const corpo: Saude = {
    status: alcancavel ? 'ok' : 'degradado',
    verificadoEm: new Date().toISOString(),
    configuracao,
    banco: {
      alcancavel,
      latenciaMs: alcancavel ? Date.now() - inicio : null,
      ...(erro == null ? {} : { erro }),
    },
  };

  return NextResponse.json(corpo, {
    status: alcancavel ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}

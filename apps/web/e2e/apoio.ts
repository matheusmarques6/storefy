/**
 * Apoio dos testes E2E: criação e limpeza de usuários reais de teste.
 *
 * Regra 1 do CLAUDE.md: dado de teste só existe isolado no ambiente de teste e
 * é removido no final. Nada disso pode sobrar no app.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import type { Page } from '@playwright/test';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** Só rodamos os testes quando há um Supabase configurado para apontar. */
export const SUPABASE_DISPONIVEL = URL !== '' && SERVICE_ROLE !== '';

export const MOTIVO_PULO =
  'Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para rodar os testes E2E ' +
  'contra um Supabase de teste com as migrations aplicadas.';

export const SENHA_PADRAO = 'SenhaDeTeste123';

/** Prefixo que marca tudo que é descartável, para a limpeza reconhecer. */
const PREFIXO = 'e2e-storefy';

function admin() {
  return createClient<Database>(URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function emailDeTeste(rotulo: string): string {
  const aleatorio = Math.random().toString(36).slice(2, 10);
  return `${PREFIXO}+${rotulo}-${aleatorio}@exemplo.test`;
}

/**
 * Cria um usuário já confirmado, direto pela API admin.
 * Pular a confirmação por e-mail aqui é proposital: o fluxo de confirmação tem
 * teste próprio, e depender de caixa de entrada deixaria a suíte instável.
 */
export async function criarUsuarioConfirmado(email: string, nomeEmpresa: string): Promise<string> {
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password: SENHA_PADRAO,
    email_confirm: true,
    user_metadata: { company_name: nomeEmpresa },
  });
  if (error != null) throw new Error(`Não foi possível criar o usuário de teste: ${error.message}`);
  return data.user.id;
}

/** Promove um usuário a administrador da plataforma. */
export async function tornarPlatformAdmin(userId: string): Promise<void> {
  const { error } = await admin()
    .from('platform_admins')
    .upsert({ user_id: userId, role: 'superadmin' }, { onConflict: 'user_id' });
  if (error != null) throw new Error(`Não foi possível criar o admin de teste: ${error.message}`);
}

/**
 * Remove todo usuário de teste criado pela suíte.
 *
 * Organização, lojas e apps caem por cascade a partir de auth.users. A trilha
 * de auditoria NÃO cai: `audit_logs.org_id` não tem chave estrangeira, de
 * propósito, para a trilha sobreviver à exclusão da organização. Então ela
 * precisa ser removida aqui explicitamente — a regra 1 do CLAUDE.md exige que
 * o dado de teste não sobre em lugar nenhum.
 */
export async function limparUsuariosDeTeste(): Promise<void> {
  const cliente = admin();
  const orgsDeTeste = new Set<string>();

  for (let pagina = 1; pagina <= 10; pagina += 1) {
    const { data, error } = await cliente.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error != null || data.users.length === 0) break;

    const descartaveis = data.users.filter((u) => u.email?.startsWith(`${PREFIXO}+`) === true);

    for (const usuario of descartaveis) {
      // As organizações precisam ser coletadas ANTES: depois de excluir o
      // usuário, o vínculo em memberships já não existe para consultar.
      const { data: vinculos } = await cliente
        .from('memberships')
        .select('org_id')
        .eq('user_id', usuario.id);
      for (const vinculo of vinculos ?? []) orgsDeTeste.add(vinculo.org_id);

      await cliente.auth.admin.deleteUser(usuario.id);
    }

    if (data.users.length < 200) break;
  }

  if (orgsDeTeste.size > 0) {
    await cliente
      .from('audit_logs')
      .delete()
      .in('org_id', [...orgsDeTeste]);
  }
}

/** Faz login pela interface, como o usuário faria. */
export async function entrar(page: Page, email: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA_PADRAO);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('/');
}

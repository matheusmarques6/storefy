/**
 * Apoio dos testes E2E: criação e limpeza de usuários reais de teste.
 *
 * Regra 1 do CLAUDE.md: dado de teste só existe isolado no ambiente de teste e
 * é removido no final. Nada disso pode sobrar no app.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database, PlatformAdminRole } from '@storefy/db';
import type { Page } from '@playwright/test';
import { codigoTotp } from './totp';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

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

/**
 * O banco visto de fora, para o teste conferir o que a TELA gravou.
 *
 * Só leitura de conferência: nenhum teste deve preparar dado por aqui o que a
 * interface consegue fazer — senão o teste prova o banco, e não o produto.
 */
export function bancoDeTeste() {
  return admin();
}

/** Cadastra uma loja pela interface e devolve o id dela. */
export async function criarLojaPelaTela(
  page: Page,
  nome: string,
  endereco: string,
): Promise<string> {
  await page.goto('/lojas/nova');
  await page.getByLabel('Nome da loja').fill(nome);
  await page.getByLabel('Endereço da loja').fill(endereco);
  await page.getByRole('button', { name: 'Criar loja' }).click();
  // O cadastro segue para o começo guiado: o visual do app (C03).
  await page.waitForURL(/\/lojas\/[0-9a-f-]{36}\/comecar$/);

  const id = /\/lojas\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (id === undefined) throw new Error(`A loja não foi criada: ${page.url()}`);
  return id;
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
    // A marca que o banco aceita com o cadastro fechado (A13): o usuário de
    // teste é criado pela "equipe", pela service role, como no bootstrap.
    app_metadata: { criado_pela_equipe: true },
  });
  if (error != null) throw new Error(`Não foi possível criar o usuário de teste: ${error.message}`);
  return data.user.id;
}

/**
 * O segredo do app autenticador de cada admin de teste, pelo e-mail: é com ele
 * que `entrar` digita o código do segundo fator, como a pessoa faria olhando
 * o celular.
 */
const segredosDoApp = new Map<string, string>();

/**
 * Cadastra e confirma um app autenticador para a conta, pela API do Auth — o
 * que o celular faria lendo o QR code. Devolve o segredo, para calcular os
 * códigos seguintes.
 *
 * A sessão usada aqui é só do cadastro, e sai no fim (escopo local: a do
 * navegador do teste, se houver, continua).
 */
export async function cadastrarAppAutenticador(email: string): Promise<string> {
  const cliente = createClient<Database>(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: erroDoLogin } = await cliente.auth.signInWithPassword({
    email,
    password: SENHA_PADRAO,
  });
  if (erroDoLogin != null) throw new Error(`Login do cadastro do app: ${erroDoLogin.message}`);

  const { data, error } = await cliente.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'Storefy Admin',
    friendlyName: 'Storefy Admin',
  });
  if (error != null) throw new Error(`Cadastro do app autenticador: ${error.message}`);

  const { error: erroDaConfirmacao } = await cliente.auth.mfa.challengeAndVerify({
    factorId: data.id,
    code: codigoTotp(data.totp.secret),
  });
  if (erroDaConfirmacao != null) {
    throw new Error(`Confirmação do app autenticador: ${erroDaConfirmacao.message}`);
  }

  await cliente.auth.signOut({ scope: 'local' });
  return data.totp.secret;
}

/** O segredo do app de um admin de teste — para usar o código fora da tela, direto na API. */
export function segredoDoAppDeTeste(email: string): string {
  const segredo = segredosDoApp.get(email);
  if (segredo === undefined) throw new Error(`${email} não tem app autenticador de teste.`);
  return segredo;
}

/**
 * Promove um usuário a administrador da plataforma — já com o app
 * autenticador cadastrado, porque sem ele a equipe não entra no painel (A01).
 * O `entrar` seguinte digita o código sozinho.
 */
export async function tornarPlatformAdmin(
  userId: string,
  papel: PlatformAdminRole = 'superadmin',
): Promise<void> {
  const banco = admin();
  const { error } = await banco
    .from('platform_admins')
    .upsert({ user_id: userId, role: papel }, { onConflict: 'user_id' });
  if (error != null) throw new Error(`Não foi possível criar o admin de teste: ${error.message}`);

  const { data, error: erroDoUsuario } = await banco.auth.admin.getUserById(userId);
  const email = data.user?.email;
  if (erroDoUsuario != null || email === undefined) {
    throw new Error(`Admin de teste sem e-mail: ${erroDoUsuario?.message ?? userId}`);
  }
  segredosDoApp.set(email, await cadastrarAppAutenticador(email));
}

/**
 * Na tela de cadastro do app (/admin/ativar-2fa), faz o que a pessoa faria
 * com o celular: começa, "lê" a chave mostrada (a mesma do QR code) e digita
 * o primeiro código. Devolve a chave, para os códigos seguintes.
 */
export async function ativarAppPelaTela(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Começar' }).click();
  await page
    .getByRole('img', { name: 'QR code para cadastrar a Storefy Admin no app autenticador' })
    .waitFor();
  const chave = await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/).innerText();
  const segredo = chave.replace(/\s/g, '');
  await page.getByLabel('Código que o app mostra').fill(codigoTotp(segredo));
  await page.getByRole('button', { name: 'Ativar e entrar' }).click();
  return segredo;
}

/**
 * Na tela do segundo fator (/admin/verificar), digita o código do app — o
 * passo que a equipe dá depois da senha.
 */
export async function digitarCodigoDoApp(page: Page, segredo: string): Promise<void> {
  await page.getByLabel('Código do app').fill(codigoTotp(segredo));
  await page.getByRole('button', { name: 'Confirmar' }).click();
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

    /*
     * A trilha sem cliente (org nula) — mudanças na equipe, segundo fator —
     * não sai pela organização. Sai por quem fez ou sobre quem foi, e ANTES
     * de excluir os usuários: depois, o `actor_id` vira nulo e a linha não
     * tem mais como ser achada.
     */
    const ids = descartaveis.map((usuario) => usuario.id);
    for (let inicio = 0; inicio < ids.length; inicio += 50) {
      const lote = ids.slice(inicio, inicio + 50);
      await cliente.from('audit_logs').delete().is('org_id', null).in('actor_id', lote);
      await cliente.from('audit_logs').delete().is('org_id', null).in('entity_id', lote);
    }

    for (const usuario of descartaveis) {
      // As organizações precisam ser coletadas ANTES: depois de excluir o
      // usuário, o vínculo em memberships já não existe para consultar.
      const { data: vinculos } = await cliente
        .from('memberships')
        .select('org_id')
        .eq('user_id', usuario.id);
      for (const vinculo of vinculos ?? []) orgsDeTeste.add(vinculo.org_id);

      /*
       * Empresa com assinatura viva não se exclui (o banco protege a cobrança
       * de quem já foi embora). A assinatura de teste mora no servidor Asaas
       * do próprio teste, que já saiu do ar: basta marcá-la como encerrada.
       */
      const orgs = (vinculos ?? []).map((vinculo) => vinculo.org_id);
      if (orgs.length > 0) {
        await cliente
          .from('subscriptions')
          .update({ cancelada_em: new Date().toISOString() })
          .in('org_id', orgs)
          .is('cancelada_em', null);
      }

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

/**
 * Faz login pela interface, como o usuário faria.
 *
 * Quem é da equipe (promovido por `tornarPlatformAdmin`) também passa pelo
 * segundo fator, digitando o código do app, e volta ao painel do cliente —
 * onde o login comum termina.
 */
export async function entrar(page: Page, email: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA_PADRAO);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL('/');

  const segredo = segredosDoApp.get(email);
  if (segredo === undefined) return;
  await page.goto('/admin/verificar');
  await digitarCodigoDoApp(page, segredo);
  await page.waitForURL((url) => url.pathname === '/admin');
  await page.goto('/');
}

/** Abre um chamado pela Ajuda (C17), como o lojista, e devolve o id. */
export async function abrirChamadoPelaTela(page: Page, titulo: string): Promise<string> {
  await page.goto('/ajuda');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Assunto').selectOption({ label: 'Publicação nas lojas de aplicativos' });
  await page.getByLabel('Título').fill(titulo);
  await page
    .getByLabel('Mensagem')
    .fill('A Apple recusou o app dizendo que falta a política de privacidade. O que eu faço?');
  await page.getByRole('button', { name: 'Abrir chamado' }).click();
  await page.waitForURL(/\/ajuda\/chamados\/[0-9a-f-]{36}$/);
  return /chamados\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
}

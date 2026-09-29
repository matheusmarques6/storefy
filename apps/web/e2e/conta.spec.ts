/**
 * Minha conta — excluir a própria conta (LGPD), de ponta a ponta: a tela diz
 * o que acontece com cada empresa, pede e-mail e senha, e o banco faz
 * exatamente o que ela disse.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  MOTIVO_PULO,
  SENHA_PADRAO,
  SUPABASE_DISPONIVEL,
  bancoDeTeste,
  criarLojaPelaTela,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
} from './apoio';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);

/** As empresas que somem com as contas: a trilha delas sai no fim. */
const empresasDoTeste: string[] = [];

test.afterAll(async () => {
  if (empresasDoTeste.length > 0) {
    await bancoDeTeste().from('audit_logs').delete().in('org_id', empresasDoTeste);
  }
  await limparUsuariosDeTeste();
});

async function excluirConta(page: Page, email: string, senha: string) {
  await page.getByRole('button', { name: 'Excluir minha conta' }).click();
  const dialogo = page.getByRole('alertdialog');
  await dialogo.getByLabel(`Para confirmar, digite ${email}`).fill(email);
  await dialogo.getByLabel('Sua senha').fill(senha);
  await dialogo.getByRole('button', { name: 'Excluir para sempre' }).click();
}

test('o único dono sai e o administrador herda; o último a sair leva a empresa junto', async ({
  page,
  browser,
}) => {
  const emailDono = emailDeTeste('conta-dono');
  const donoId = await criarUsuarioConfirmado(emailDono, 'Empresa que Fica');
  await entrar(page, emailDono);
  await criarLojaPelaTela(page, 'Loja que Fica', 'loja-que-fica.com.br');

  const { data: vinculo } = await bancoDeTeste()
    .from('memberships')
    .select('org_id')
    .eq('user_id', donoId)
    .single();
  const orgId = vinculo?.org_id ?? '';
  empresasDoTeste.push(orgId);

  // Uma administradora entra pelo convite.
  await page.goto('/configuracoes/equipe');
  await page.waitForLoadState('networkidle');
  const emailAdmin = emailDeTeste('conta-admin');
  await page.getByLabel('E-mail da pessoa').fill(emailAdmin);
  await page.getByRole('button', { name: 'Convidar', exact: true }).click();
  const link = (await page.locator('pre[data-texto]').first().textContent())?.trim() ?? '';
  const admin = await (await browser.newContext()).newPage();
  await admin.goto(link);
  await admin.getByLabel('Seu nome').fill('Bia Herdeira');
  await admin.getByLabel('Crie uma senha').fill(SENHA_PADRAO);
  await admin.getByRole('button', { name: 'Criar conta e aceitar' }).click();
  await admin.waitForURL('/');

  // O dono vê, antes, o que vai acontecer com a empresa.
  await page.goto('/configuracoes/conta');
  await expect(
    page.getByText('Empresa que Fica: Bia Herdeira passa a ser o proprietário.'),
  ).toBeVisible();

  // E-mail errado e senha errada não excluem nada.
  await page.getByRole('button', { name: 'Excluir minha conta' }).click();
  const dialogo = page.getByRole('alertdialog');
  await dialogo.getByLabel(`Para confirmar, digite ${emailDono}`).fill('outro@exemplo.test');
  await dialogo.getByLabel('Sua senha').fill(SENHA_PADRAO);
  await dialogo.getByRole('button', { name: 'Excluir para sempre' }).click();
  await expect(
    dialogo.getByText('Digite o seu e-mail exatamente como aparece acima.'),
  ).toBeVisible();
  await dialogo.getByLabel(`Para confirmar, digite ${emailDono}`).fill(emailDono);
  await dialogo.getByLabel('Sua senha').fill('senha-errada-123');
  await dialogo.getByRole('button', { name: 'Excluir para sempre' }).click();
  await expect(dialogo.getByText('Senha incorreta.')).toBeVisible();
  // O e-mail digitado continua lá; a senha, não.
  await expect(dialogo.getByLabel(`Para confirmar, digite ${emailDono}`)).toHaveValue(emailDono);
  await expect(dialogo.getByLabel('Sua senha')).toHaveValue('');
  await dialogo.getByRole('button', { name: 'Voltar' }).click();

  await excluirConta(page, emailDono, SENHA_PADRAO);
  await page.waitForURL(/\/entrar\?aviso=conta-excluida/);
  await expect(page.getByText('Sua conta foi excluída')).toBeVisible();

  // A conta sumiu, e a sessão com ela.
  const { data: contaDoDono } = await bancoDeTeste().rpc('admin_usuario_por_email', {
    p_email: emailDono,
  });
  expect(contaDoDono).toBeNull();
  await page.goto('/');
  await page.waitForURL(/\/entrar/);

  // A administradora virou proprietária, como a tela disse.
  await admin.goto('/configuracoes/equipe');
  await expect(admin.getByText('Proprietário', { exact: true }).first()).toBeVisible();
  await expect(admin.getByRole('heading', { name: 'Convidar alguém' })).toBeVisible();

  // Agora ela é a única pessoa: excluir a conta leva a empresa e a loja.
  await admin.goto('/configuracoes/conta');
  await expect(
    admin.getByText(
      'Empresa que Fica: será EXCLUÍDA, com 1 loja e o app dela — você é a única pessoa nela.',
    ),
  ).toBeVisible();
  await excluirConta(admin, emailAdmin, SENHA_PADRAO);
  await admin.waitForURL(/\/entrar\?aviso=conta-excluida/);

  const banco = bancoDeTeste();
  const { data: empresa } = await banco.from('organizations').select('id').eq('id', orgId);
  expect(empresa).toEqual([]);
  const { data: lojas } = await banco.from('stores').select('id').eq('org_id', orgId);
  expect(lojas).toEqual([]);

  // A trilha da empresa guarda quem saiu e o que aconteceu.
  const { data: trilha } = await banco
    .from('audit_logs')
    .select('diff')
    .eq('org_id', orgId)
    .eq('entity', 'conta');
  expect(JSON.stringify(trilha)).toContain('"para":"passa_para"');
  expect(JSON.stringify(trilha)).toContain('"para":"excluida"');
  expect(JSON.stringify(trilha)).toContain(emailDono);
});

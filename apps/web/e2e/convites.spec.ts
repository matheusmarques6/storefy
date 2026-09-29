/**
 * Convites (C16, A03, A11), de ponta a ponta pela interface: quem convida,
 * quem recebe o link, a conta que nasce por ele, o papel, a remoção e o
 * cadastro fechado.
 *
 * O e-mail não está configurado no ambiente de teste — é exatamente o caminho
 * em que a tela precisa mostrar o link para copiar, e o teste o usa.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Json } from '@storefy/db';
import {
  MOTIVO_PULO,
  SENHA_PADRAO,
  SUPABASE_DISPONIVEL,
  bancoDeTeste,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
  tornarPlatformAdmin,
} from './apoio';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);

let chavesDeAntes: { chave: string; valor: Json }[] = [];
const equipeDeTeste: string[] = [];

test.beforeAll(async () => {
  const { data } = await bancoDeTeste().from('platform_settings').select('chave, valor');
  chavesDeAntes = data ?? [];
});

test.afterAll(async () => {
  const banco = bancoDeTeste();
  await banco.from('platform_settings').delete().neq('chave', '');
  if (chavesDeAntes.length > 0) await banco.from('platform_settings').insert(chavesDeAntes);
  if (equipeDeTeste.length > 0) {
    // A trilha da plataforma (convites de lojista e de equipe) não tem empresa.
    await banco.from('audit_logs').delete().is('org_id', null).in('actor_id', equipeDeTeste);
  }
  // Convites de plataforma para e-mails de teste que ninguém aceitou.
  await banco.from('invitations').delete().like('email', 'e2e-storefy+%');
  await limparUsuariosDeTeste();
});

async function novaPagina(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

/** O link que a tela mostra uma vez, depois de convidar. */
async function linkMostrado(page: Page): Promise<string> {
  const texto = page.locator('pre[data-texto]').first();
  await expect(texto).toBeVisible();
  const link = (await texto.textContent())?.trim() ?? '';
  expect(link).toMatch(/\/convite\/[A-Za-z0-9_-]{43}$/);
  return link;
}

async function convidarNaEquipe(page: Page, email: string, papel: 'Administrador' | 'Membro') {
  await page.goto('/configuracoes/equipe');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail da pessoa').fill(email);
  await page.getByLabel('Papel', { exact: true }).selectOption({ label: papel });
  await page.getByRole('button', { name: 'Convidar', exact: true }).click();
  await expect(page.getByText(`Convite criado para ${email}`)).toBeVisible();
  return linkMostrado(page);
}

async function superadmin(page: Page, rotulo: string): Promise<string> {
  const email = emailDeTeste(rotulo);
  const id = await criarUsuarioConfirmado(email, `Equipe ${rotulo}`);
  await tornarPlatformAdmin(id);
  equipeDeTeste.push(id);
  await entrar(page, email);
  return id;
}

test('o proprietário convida, a pessoa cria a conta pelo link e entra só nesta empresa', async ({
  page,
  browser,
}) => {
  const emailDono = emailDeTeste('conv-dono');
  await criarUsuarioConfirmado(emailDono, 'Empresa do Convite');
  await entrar(page, emailDono);

  const emailConvidado = emailDeTeste('conv-novo');
  const link = await convidarNaEquipe(page, emailConvidado, 'Administrador');
  // O convite aparece em aberto, e o formulário volta limpo.
  await expect(page.getByLabel('E-mail da pessoa')).toHaveValue('');
  await page.reload();
  await expect(page.getByText(emailConvidado, { exact: true })).toBeVisible();
  await expect(page.getByText('Vence em 7 dias')).toBeVisible();

  // Quem recebeu o link, sem conta nenhuma.
  const convidado = await novaPagina(browser);
  await convidado.goto(link);
  await expect(convidado.getByText('Convite para a equipe de Empresa do Convite')).toBeVisible();
  await expect(convidado.getByText(/Administrador: Cria e edita lojas/)).toBeVisible();
  await expect(convidado.getByLabel('E-mail')).toHaveValue(emailConvidado);
  // Nome faltando: erro no campo, e a senha digitada não volta.
  await convidado.getByLabel('Crie uma senha').fill(SENHA_PADRAO);
  await convidado.getByRole('button', { name: 'Criar conta e aceitar' }).click();
  await expect(convidado.getByText('Digite seu nome, com pelo menos 2 letras.')).toBeVisible();

  await convidado.getByLabel('Seu nome').fill('Pessoa Convidada');
  await convidado.getByLabel('Crie uma senha').fill(SENHA_PADRAO);
  await convidado.getByRole('button', { name: 'Criar conta e aceitar' }).click();
  await convidado.waitForURL('/');
  await expect(convidado.getByRole('heading', { name: 'Olá, Empresa do Convite' })).toBeVisible();

  // Só a empresa do convite: nenhuma empresa vazia com o nome da pessoa.
  const banco = bancoDeTeste();
  const { data: conta } = await banco.rpc('admin_usuario_por_email', { p_email: emailConvidado });
  const { data: vinculos } = await banco
    .from('memberships')
    .select('role, organizations(name)')
    .eq('user_id', conta ?? '');
  expect(vinculos).toEqual([{ role: 'admin', organizations: { name: 'Empresa do Convite' } }]);

  // Administrador vê a equipe, mas não convida nem mexe em papéis.
  await convidado.goto('/configuracoes/equipe');
  await expect(
    convidado.getByText('Só o proprietário convida pessoas e muda papéis.'),
  ).toBeVisible();
  await expect(convidado.getByLabel('E-mail da pessoa')).toHaveCount(0);
  await expect(convidado.getByRole('button', { name: /Remover/ })).toHaveCount(0);

  // O link já usado não serve de novo.
  const outro = await novaPagina(browser);
  await outro.goto(link);
  await expect(outro.getByText('Convite já usado')).toBeVisible();

  // O proprietário muda o papel, com confirmação dizendo o que muda.
  await page.goto('/configuracoes/equipe');
  await page.getByLabel('Papel de Pessoa Convidada').selectOption('member');
  await expect(page.getByRole('alertdialog')).toContainText('Só vê.');
  await page.getByRole('button', { name: 'Mudar papel' }).click();
  await expect(page.getByText('Papel alterado para Membro.')).toBeVisible();

  // E tira da equipe: o acesso acaba na hora.
  await page.getByRole('button', { name: 'Remover Pessoa Convidada' }).click();
  await expect(page.getByRole('alertdialog')).toContainText(
    'O acesso ao painel desta empresa acaba agora',
  );
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remover' }).click();
  await expect(page.getByText('Pessoa removida da equipe.')).toBeVisible();

  // Sem empresa nenhuma, a pessoa cai numa tela que diz o que fazer.
  await convidado.goto('/');
  await convidado.waitForURL('/sem-empresa');
  await expect(
    convidado.getByRole('heading', { name: 'Sua conta não está em nenhuma empresa' }),
  ).toBeVisible();
  // E pode excluir a conta dali mesmo, sem afetar empresa nenhuma.
  await expect(convidado.getByText('Nenhuma empresa é afetada')).toBeVisible();
  await expect(convidado.getByRole('button', { name: 'Criar empresa' })).toBeVisible();
});

test('conta que já existe entra e aceita; conta errada troca; cancelado e reenviado matam o link', async ({
  page,
  browser,
}) => {
  const emailDono = emailDeTeste('conv-dono2');
  await criarUsuarioConfirmado(emailDono, 'Empresa Dois');
  await entrar(page, emailDono);

  // Alguém que já usa a Storefy, com a própria empresa.
  const emailExistente = emailDeTeste('conv-existente');
  await criarUsuarioConfirmado(emailExistente, 'Empresa Própria');
  const link = await convidarNaEquipe(page, emailExistente, 'Membro');

  // Outra pessoa logada abre o link: a tela explica e oferece trocar.
  const intrusoEmail = emailDeTeste('conv-intruso');
  await criarUsuarioConfirmado(intrusoEmail, 'Empresa Intrusa');
  const intruso = await novaPagina(browser);
  await entrar(intruso, intrusoEmail);
  await intruso.goto(link);
  await expect(intruso.getByText(`Este convite é para ${emailExistente}`)).toBeVisible();
  await expect(intruso.getByRole('button', { name: 'Aceitar convite' })).toHaveCount(0);
  await intruso.getByRole('button', { name: 'Sair e usar o e-mail do convite' }).click();
  // Fora da conta errada, o convite pede para entrar com a certa.
  await expect(intruso.getByText(`Já existe uma conta com ${emailExistente}`)).toBeVisible();

  // A pessoa certa entra pelo link e aceita.
  await intruso.getByRole('link', { name: 'Entrar e aceitar' }).click();
  await intruso.getByLabel('E-mail').fill(emailExistente);
  await intruso.getByLabel('Senha').fill(SENHA_PADRAO);
  await intruso.getByRole('button', { name: 'Entrar', exact: true }).click();
  await intruso.waitForURL(/\/convite\//);
  await intruso.getByRole('button', { name: 'Aceitar convite' }).click();
  await intruso.waitForURL('/');
  // Cai na empresa que a convidou, e continua com a própria.
  await expect(intruso.getByRole('heading', { name: 'Olá, Empresa Dois' })).toBeVisible();

  // Sair da empresa que convidou devolve à própria.
  await intruso.goto('/configuracoes/equipe');
  await intruso.getByRole('button', { name: 'Sair desta empresa' }).click();
  await expect(intruso.getByRole('alertdialog')).toContainText('Suas outras empresas continuam');
  await intruso.getByRole('alertdialog').getByRole('button', { name: 'Sair' }).click();
  await intruso.waitForURL('/');
  await expect(intruso.getByRole('heading', { name: 'Olá, Empresa Própria' })).toBeVisible();

  // Um convite cancelado: o link deixa de valer.
  const emailCancelado = emailDeTeste('conv-cancelado');
  const linkCancelado = await convidarNaEquipe(page, emailCancelado, 'Membro');
  await page.reload();
  await page.getByRole('button', { name: `Cancelar o convite de ${emailCancelado}` }).click();
  await page.getByRole('button', { name: 'Cancelar convite' }).click();
  await expect(page.getByText(`Convite de ${emailCancelado} cancelado.`)).toBeVisible();
  const visitante = await novaPagina(browser);
  await visitante.goto(linkCancelado);
  await expect(visitante.getByText('Este convite foi cancelado.')).toBeVisible();

  // Reenviar gera outro link, e o anterior morre.
  const emailReenvio = emailDeTeste('conv-reenvio');
  const linkAntigo = await convidarNaEquipe(page, emailReenvio, 'Membro');
  await page.reload();
  await page.getByRole('button', { name: `Reenviar o convite de ${emailReenvio}` }).click();
  await expect(page.getByText(`Convite renovado para ${emailReenvio}`)).toBeVisible();
  const linkNovo = await linkMostrado(page);
  expect(linkNovo).not.toBe(linkAntigo);
  await visitante.goto(linkAntigo);
  await expect(visitante.getByText('Não encontramos este convite.')).toBeVisible();
  await visitante.goto(linkNovo);
  await expect(visitante.getByText('Convite para a equipe de Empresa Dois')).toBeVisible();
});

test('com o cadastro fechado, o lojista piloto e o colega da equipe entram pelo convite', async ({
  page,
  browser,
}) => {
  await superadmin(page, 'conv-equipe');

  // Fecha o cadastro pela A13.
  await page.goto('/admin/sistema');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Cadastro aberto').uncheck();
  await page.getByRole('button', { name: 'Salvar chaves' }).click();
  await expect(page.getByText('Chaves salvas.')).toBeVisible();

  // A03: convidar o lojista piloto.
  await page.goto('/admin/organizacoes');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('O cadastro está fechado (A13)')).toBeVisible();
  const emailPiloto = emailDeTeste('conv-piloto');
  await page.getByLabel('E-mail do lojista').fill(emailPiloto);
  await page.getByRole('button', { name: 'Convidar lojista' }).click();
  await expect(page.getByText(`Convite criado para ${emailPiloto}`)).toBeVisible();
  const linkDoPiloto = await linkMostrado(page);

  const piloto = await novaPagina(browser);
  await piloto.goto('/cadastrar');
  await expect(piloto.getByText('Cadastros fechados por enquanto')).toBeVisible();
  await piloto.goto(linkDoPiloto);
  await expect(piloto.getByText('Convite para criar sua conta na Storefy')).toBeVisible();
  await piloto.getByLabel('Seu nome').fill('Lojista Piloto');
  await piloto.getByLabel('Nome da sua empresa').fill('Loja Piloto');
  await piloto.getByLabel('Crie uma senha').fill(SENHA_PADRAO);
  await piloto.getByRole('button', { name: 'Criar conta e aceitar' }).click();
  await piloto.waitForURL('/');
  await expect(piloto.getByRole('heading', { name: 'Olá, Loja Piloto' })).toBeVisible();

  // A11: um colega que ainda não tem conta.
  await page.goto('/admin/equipe');
  await page.waitForLoadState('networkidle');
  const emailColega = emailDeTeste('conv-colega');
  await page.getByLabel('E-mail').fill(emailColega);
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByText(`${emailColega} ainda não tinha conta.`).first()).toBeVisible();
  const linkDoColega = await linkMostrado(page);
  await page.reload();
  await expect(page.getByText(emailColega, { exact: true })).toBeVisible();

  const colega = await novaPagina(browser);
  await colega.goto(linkDoColega);
  await expect(colega.getByText('Convite para a equipe da Storefy')).toBeVisible();
  await expect(colega.getByText('Suporte')).toBeVisible();
  await colega.getByLabel('Seu nome').fill('Colega Novo');
  await colega.getByLabel('Crie uma senha').fill(SENHA_PADRAO);
  await colega.getByRole('button', { name: 'Criar conta e aceitar' }).click();
  await colega.waitForURL(/\/admin/);
  await expect(colega.getByRole('heading', { name: 'Visão geral' })).toBeVisible();

  const { data: idDoColega } = await bancoDeTeste().rpc('admin_usuario_por_email', {
    p_email: emailColega,
  });
  if (idDoColega != null) equipeDeTeste.push(idDoColega);
  const { data: papel } = await bancoDeTeste()
    .from('platform_admins')
    .select('role')
    .eq('user_id', idDoColega ?? '')
    .maybeSingle();
  expect(papel?.role).toBe('support');
});

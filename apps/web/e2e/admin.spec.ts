/** A01, A02 e a guarda do painel admin. */
import { expect, test } from '@playwright/test';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  bancoDeTeste,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
  tornarPlatformAdmin,
} from './apoio';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

test('usuário comum autenticado é barrado no admin', async ({ page }) => {
  const email = emailDeTeste('cliente-no-admin');
  await criarUsuarioConfirmado(email, 'Empresa Cliente');
  await entrar(page, email);

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/sem-acesso/);
  await expect(page.getByText('Acesso restrito')).toBeVisible();
  // Nada de dado de outras organizações vaza nessa tela.
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('visitante sem sessão é mandado para o login do admin', async ({ page }) => {
  await page.goto('/admin/lojas');
  await expect(page).toHaveURL(/\/admin\/entrar/);
});

test('platform admin enxerga organizações e lojas de todos os clientes', async ({ browser }) => {
  const contextoCliente = await browser.newContext();
  const contextoAdmin = await browser.newContext();
  const paginaCliente = await contextoCliente.newPage();
  const paginaAdmin = await contextoAdmin.newPage();

  const emailCliente = emailDeTeste('cliente-visivel');
  const empresa = `Empresa Visivel ${Math.random().toString(36).slice(2, 8)}`;
  await criarUsuarioConfirmado(emailCliente, empresa);

  await entrar(paginaCliente, emailCliente);
  await paginaCliente.goto('/lojas/nova');
  await paginaCliente.getByLabel('Nome da loja').fill('Loja Visivel');
  await paginaCliente.getByLabel('Endereço da loja').fill('loja-visivel.com.br');
  await paginaCliente.getByRole('button', { name: 'Criar loja' }).click();
  await paginaCliente.waitForURL(/\/lojas\/[0-9a-f-]+/);

  const emailAdmin = emailDeTeste('equipe');
  const idAdmin = await criarUsuarioConfirmado(emailAdmin, 'Equipe Storefy');
  await tornarPlatformAdmin(idAdmin);

  await entrar(paginaAdmin, emailAdmin);

  /*
   * A02 primeiro: `/admin` é a visão geral, e a lista de organizações mudou
   * para `/admin/organizacoes`. O cliente criado acima nasce `trialing`, então
   * a plataforma não está vazia e o panorama aparece com "Em teste" contando
   * pelo menos ele.
   */
  await paginaAdmin.goto('/admin');
  await expect(paginaAdmin.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
  await expect(paginaAdmin.getByRole('heading', { name: 'A plataforma hoje' })).toBeVisible();
  // Faturamento não é inventado: o MRR sai das assinaturas em dia, em reais.
  await expect(
    paginaAdmin.getByRole('link', { name: /^Receita recorrente \(MRR\): R\$\s[\d.]+,\d{2}$/ }),
  ).toBeVisible();

  // E daqui se chega à lista pelo menu.
  await paginaAdmin.getByRole('link', { name: 'Organizações' }).first().click();
  await expect(paginaAdmin).toHaveURL(/\/admin\/organizacoes/);

  await paginaAdmin.getByRole('searchbox').fill(empresa);
  await paginaAdmin.getByRole('button', { name: 'Buscar' }).click();
  await expect(paginaAdmin.getByRole('cell', { name: empresa })).toBeVisible();
  // Sem assinatura, a coluna do plano diz até quando vai o teste.
  await expect(
    paginaAdmin.getByRole('row', { name: new RegExp(empresa) }).getByText(/^Teste até \d/),
  ).toBeVisible();

  // Detalhe mostra loja e membro.
  await paginaAdmin.getByRole('link', { name: 'Detalhes' }).first().click();
  // A loja aparece na tabela de lojas e no bloco "App e push".
  await expect(paginaAdmin.getByRole('cell', { name: 'Loja Visivel' })).toBeVisible();
  await expect(
    paginaAdmin.getByRole('region', { name: 'App e push' }).getByRole('heading', {
      name: 'Loja Visivel',
    }),
  ).toBeVisible();
  await expect(
    paginaAdmin.getByRole('region', { name: 'Membros' }).getByText(emailCliente),
  ).toBeVisible();

  // A auditoria registrou a criação da loja.
  await paginaAdmin.goto('/admin/logs');
  await expect(paginaAdmin.getByRole('cell', { name: 'stores' }).first()).toBeVisible();

  await contextoCliente.close();
  await contextoAdmin.close();
});

/*
 * A equipe da plataforma também é cliente: tem a própria organização. Ao abrir
 * o painel do cliente, é ELA que precisa aparecer.
 *
 * O defeito: o contexto do painel buscava os vínculos confiando só na RLS, e a
 * RLS deixa a equipe ler os vínculos de TODO mundo. O admin caía na
 * organização mais antiga da plataforma — de outro cliente —, com o papel de
 * outra pessoa.
 */
test('admin no painel do cliente vê a própria organização, e não a de outro cliente', async ({
  browser,
}) => {
  const contextoCliente = await browser.newContext();
  const contextoAdmin = await browser.newContext();
  const paginaCliente = await contextoCliente.newPage();
  const paginaAdmin = await contextoAdmin.newPage();

  // O cliente vem PRIMEIRO: a organização dele é mais antiga que a do admin.
  const sufixo = Math.random().toString(36).slice(2, 8);
  const emailCliente = emailDeTeste('cliente-alheio');
  await criarUsuarioConfirmado(emailCliente, `Empresa Alheia ${sufixo}`);
  await entrar(paginaCliente, emailCliente);
  await paginaCliente.goto('/lojas/nova');
  await paginaCliente.getByLabel('Nome da loja').fill(`Loja Alheia ${sufixo}`);
  await paginaCliente.getByLabel('Endereço da loja').fill(`loja-alheia-${sufixo}.com.br`);
  await paginaCliente.getByRole('button', { name: 'Criar loja' }).click();
  await paginaCliente.waitForURL(/\/lojas\/[0-9a-f-]+/);

  const emailAdmin = emailDeTeste('equipe-cliente');
  const idAdmin = await criarUsuarioConfirmado(emailAdmin, `Equipe Propria ${sufixo}`);
  await tornarPlatformAdmin(idAdmin);
  await entrar(paginaAdmin, emailAdmin);

  await expect(
    paginaAdmin.getByText(`Storefy by Convertfy · Equipe Propria ${sufixo}`),
  ).toBeVisible();

  await paginaAdmin.goto('/lojas');
  await expect(paginaAdmin.getByText(`Loja Alheia ${sufixo}`)).toHaveCount(0);
  await expect(paginaAdmin.getByText(`Empresa Alheia ${sufixo}`)).toHaveCount(0);

  await contextoCliente.close();
  await contextoAdmin.close();
});

/*
 * A03: a equipe anda pela base pelos filtros — plano, situação, etapa do
 * começo e saúde —, e cada linha diz se o cliente precisa de alguém e por quê.
 */
test('A03: os filtros acham o cliente que precisa de alguém, e dizem por quê', async ({ page }) => {
  const sufixo = Math.random().toString(36).slice(2, 8);
  const emailParado = emailDeTeste('a03-parado');
  const idParado = await criarUsuarioConfirmado(emailParado, `Cliente Parado ${sufixo}`);
  const emailEmDia = emailDeTeste('a03-em-dia');
  await criarUsuarioConfirmado(emailEmDia, `Cliente Em Dia ${sufixo}`);

  // O teste do "parado" acabou ontem, e ele não assinou.
  const banco = bancoDeTeste();
  const { data: vinculo } = await banco
    .from('memberships')
    .select('org_id')
    .eq('user_id', idParado)
    .single();
  const { error } = await banco
    .from('organizations')
    .update({ trial_ends_at: new Date(Date.now() - 86_400_000).toISOString() })
    .eq('id', vinculo?.org_id ?? '');
  expect(error).toBeNull();

  const emailAdmin = emailDeTeste('equipe-a03');
  const idAdmin = await criarUsuarioConfirmado(emailAdmin, 'Equipe A03');
  await tornarPlatformAdmin(idAdmin);
  await entrar(page, emailAdmin);

  await page.goto(`/admin/organizacoes?q=${encodeURIComponent(sufixo)}`);
  await expect(
    page.getByRole('row', { name: new RegExp(`Cliente Parado ${sufixo}`) }),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: new RegExp(`Cliente Em Dia ${sufixo}`) }),
  ).toBeVisible();

  // Saúde crítica: só o parado, com o motivo e a etapa na linha.
  await page.getByLabel('Saúde').selectOption('critica');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page).toHaveURL(/saude=critica/);
  await expect(page).toHaveURL(new RegExp(`q=${sufixo}`));
  const parado = page.getByRole('row', { name: new RegExp(`Cliente Parado ${sufixo}`) });
  await expect(parado).toBeVisible();
  await expect(parado.getByText('Crítica')).toBeVisible();
  await expect(parado.getByText('O teste acabou sem assinatura')).toBeVisible();
  await expect(parado.getByText('Sem loja')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`Cliente Em Dia ${sufixo}`) })).toHaveCount(
    0,
  );

  // A busca mantém o filtro; filtro sem resultado diz "nada encontrado".
  await page.getByLabel('Etapa do começo').selectOption('no_ar');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page.getByText('Nada encontrado')).toBeVisible();
  await expect(
    page.getByText('Nenhuma organização corresponde à busca e aos filtros escolhidos.'),
  ).toBeVisible();

  // Limpar tira os filtros e mantém a busca — e os seletores voltam a "Todos".
  await page.getByRole('link', { name: 'Limpar filtros' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/organizacoes\\?q=${sufixo}$`));
  await expect(page.getByLabel('Saúde')).toHaveValue('');
  await expect(page.getByLabel('Etapa do começo')).toHaveValue('');
  await expect(
    page.getByRole('row', { name: new RegExp(`Cliente Em Dia ${sufixo}`) }),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: new RegExp(`Cliente Em Dia ${sufixo}`) }).getByText('Boa'),
  ).toBeVisible();

  // Filtro inventado na URL é ignorado, e não vira erro.
  await page.goto(`/admin/organizacoes?q=${sufixo}&saude=hackeada&etapa=%27%3B`);
  await expect(
    page.getByRole('row', { name: new RegExp(`Cliente Parado ${sufixo}`) }),
  ).toBeVisible();
});

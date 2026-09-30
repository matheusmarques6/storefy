/**
 * "Ver como cliente" (A04): a equipe abre o painel de um cliente, só para ler.
 *
 * O que estes testes provam é o que torna a função segura de existir: que ler
 * é TUDO que dá para fazer — nem pela tela, nem por requisição direta —, que
 * abrir e fechar ficam na auditoria com o motivo, e que o acesso é de uma
 * pessoa só, por tempo limitado.
 */
import type { Browser, Page } from '@playwright/test';
import { expect, test } from './base';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  bancoDeTeste,
  criarLojaPelaTela,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
  tornarPlatformAdmin,
} from './apoio';
import { varrer } from './axe';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

interface Cenario {
  cliente: Page;
  admin: Page;
  orgDoCliente: string;
  empresa: string;
  adminId: string;
}

async function montar(browser: Browser, rotulo: string): Promise<Cenario> {
  const sufixo = Math.random().toString(36).slice(2, 8);
  const empresa = `Cliente Visitado ${sufixo}`;

  const cliente = await (await browser.newContext()).newPage();
  const emailCliente = emailDeTeste(`${rotulo}-cliente`);
  const clienteId = await criarUsuarioConfirmado(emailCliente, empresa);
  await entrar(cliente, emailCliente);
  await criarLojaPelaTela(cliente, `Loja Visitada ${sufixo}`, `loja-visitada-${sufixo}.com.br`);

  const { data: vinculo } = await bancoDeTeste()
    .from('memberships')
    .select('org_id')
    .eq('user_id', clienteId)
    .single();
  if (vinculo == null) throw new Error('O cliente de teste ficou sem organização.');

  const admin = await (await browser.newContext()).newPage();
  const emailAdmin = emailDeTeste(`${rotulo}-equipe`);
  const adminId = await criarUsuarioConfirmado(emailAdmin, `Equipe ${sufixo}`);
  await tornarPlatformAdmin(adminId);
  await entrar(admin, emailAdmin);

  return { cliente, admin, orgDoCliente: vinculo.org_id, empresa, adminId };
}

async function abrirVisita(admin: Page, orgId: string, motivo: string): Promise<void> {
  await admin.goto(`/admin/organizacoes/${orgId}`);
  await admin.waitForLoadState('networkidle');
  await admin.getByRole('button', { name: 'Ver como cliente' }).click();
  await admin.getByLabel('Motivo').fill(motivo);
  await admin.getByRole('button', { name: 'Abrir o painel' }).click();
  await admin.waitForURL('/');
}

async function trilhaDa(orgId: string) {
  const { data } = await bancoDeTeste()
    .from('audit_logs')
    .select('action, actor_id, diff, entity')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  return data ?? [];
}

test('a equipe lê o painel do cliente, não escreve nada, e tudo fica na auditoria', async ({
  browser,
}) => {
  const { admin, orgDoCliente, empresa, adminId } = await montar(browser, 'ler');

  // Sem motivo, não abre: a trilha precisa dizer POR QUE alguém entrou.
  await admin.goto(`/admin/organizacoes/${orgDoCliente}`);
  await admin.waitForLoadState('networkidle');
  await admin.getByRole('button', { name: 'Ver como cliente' }).click();
  await admin.getByRole('button', { name: 'Abrir o painel' }).click();
  await expect(
    admin.getByRole('alert').filter({ hasText: 'Diga em poucas palavras' }),
  ).toBeVisible();
  await admin.getByRole('button', { name: 'Voltar' }).click();

  await abrirVisita(admin, orgDoCliente, 'Teste: cliente diz que a loja não aparece');

  // O painel é o do CLIENTE, e a faixa diz isso em toda tela.
  await expect(
    admin.getByText(`Você está vendo o painel de ${empresa} como cliente`),
  ).toBeVisible();
  await expect(admin.getByText(`Storefy by Convertfy · ${empresa}`)).toBeVisible();
  await expect(admin.getByRole('button', { name: 'Trocar de loja' })).toContainText(
    'Loja Visitada',
  );

  // A tela não oferece escrita.
  await admin.goto('/push');
  await expect(admin.getByRole('heading', { name: 'Notificações', exact: true })).toBeVisible();
  await varrer(admin, 'C07 em visita, com a faixa da visita');
  await expect(admin.getByRole('link', { name: 'Nova campanha' })).toHaveCount(0);

  /*
   * E a escrita direta não passa: uma ação de formulário do Next é um POST
   * com o cabeçalho `Next-Action`. O proxy recusa antes de chegar em qualquer
   * ação — o banco também recusaria, porque a equipe não tem policy de
   * escrita nas tabelas do cliente.
   */
  // De dentro da página: é o navegador, com os cookies da visita, pedindo.
  const tentativa = await admin.evaluate(async () => {
    const resposta = await fetch('/push/nova', {
      method: 'POST',
      headers: { 'Next-Action': 'qualquer-uma' },
      body: '[]',
    });
    return { status: resposta.status, texto: await resposta.text() };
  });
  expect(tentativa.status).toBe(403);
  expect(tentativa.texto).toContain('somente leitura');

  /*
   * Navegar por TODAS as telas não grava nada no cliente. Toda escrita nas
   * tabelas dele deixa linha em `audit_logs` (triggers da Fase 0): se alguma
   * tela escrevesse ao abrir, apareceria aqui.
   */
  const antes = (await trilhaDa(orgDoCliente)).length;
  for (const rota of [
    '/',
    '/lojas',
    '/app',
    '/push',
    '/push/automacoes',
    '/analytics',
    '/publicacao',
    '/publicacao/contas',
    '/integracoes',
    '/configuracoes',
    '/configuracoes/conta',
  ]) {
    const resposta = await admin.goto(rota);
    expect(resposta?.status(), rota).toBe(200);
    await expect(admin.getByText('Algo deu errado'), rota).toHaveCount(0);
    await expect(admin.getByText(`Você está vendo o painel de ${empresa}`), rota).toBeVisible();
  }
  expect((await trilhaDa(orgDoCliente)).length).toBe(antes);

  // A conta que aparece não é a do cliente, e a tela diz isso.
  await admin.goto('/configuracoes/conta');
  await expect(admin.getByText('Esta tela é da sua conta, e não do cliente')).toBeVisible();

  // Encerrar volta para a ficha do cliente, e o painel volta a ser o da equipe.
  await admin.goto('/');
  await admin.getByRole('button', { name: 'Encerrar visita' }).click();
  await admin.waitForURL(`/admin/organizacoes/${orgDoCliente}`);
  await admin.goto('/');
  await expect(admin.getByText('Você está vendo o painel de')).toHaveCount(0);
  await expect(admin.getByText(`Storefy by Convertfy · ${empresa}`)).toHaveCount(0);

  // A trilha tem o começo, com o motivo, e o fim — e são da pessoa certa.
  const trilha = await trilhaDa(orgDoCliente);
  const inicio = trilha.find((linha) => linha.action === 'view_as_start');
  const fim = trilha.find((linha) => linha.action === 'view_as_end');
  expect(inicio?.actor_id).toBe(adminId);
  expect(JSON.stringify(inicio?.diff)).toContain('cliente diz que a loja não aparece');
  expect(fim?.actor_id).toBe(adminId);
});

test('o convite abre a visita só para quem o pediu', async ({ browser }) => {
  const { admin, orgDoCliente, cliente } = await montar(browser, 'convite');

  // Guarda o endereço do convite quando o admin é mandado para ele.
  let convite = '';
  admin.on('request', (requisicao) => {
    if (requisicao.url().includes('/visita/iniciar?convite=')) convite = requisicao.url();
  });
  await abrirVisita(admin, orgDoCliente, 'Teste: conferir o convite de visita');
  expect(convite).not.toBe('');

  // O cliente — ou qualquer outra pessoa — com o link na mão não abre nada.
  await cliente.goto(convite);
  await expect(cliente).toHaveURL(/\/visita\/recusada/);
  await expect(cliente.getByText('Esta visita não abriu')).toBeVisible();

  // Outra pessoa DA EQUIPE também não: o convite é de quem o pediu.
  const outraEquipe = await (await browser.newContext()).newPage();
  const email = emailDeTeste('convite-outra-equipe');
  await tornarPlatformAdmin(await criarUsuarioConfirmado(email, 'Outra Equipe'));
  await entrar(outraEquipe, email);
  await outraEquipe.goto(convite);
  await expect(outraEquipe).toHaveURL(/\/visita\/recusada/);

  // Adulterado, não abre nem para quem pediu.
  await admin.goto(convite.replace(/convite=v1\.([A-Za-z0-9_-])/, 'convite=v1.x$1'));
  await expect(admin).toHaveURL(/\/visita\/recusada/);
});

test('a visita que ficou no navegador não trava quem entra depois', async ({ browser }) => {
  const { admin, orgDoCliente } = await montar(browser, 'esquecida');
  await abrirVisita(admin, orgDoCliente, 'Teste: visita esquecida aberta');

  const cookies = await admin.context().cookies();
  const visita = cookies.find((cookie) => cookie.name === 'storefy_visita');
  expect(visita).toBeDefined();

  /*
   * Outra pessoa, no MESMO navegador, com o cookie da visita que ficou para
   * trás. O painel dela é o dela, e a escrita funciona — o cookie não é dela,
   * e o proxy o descarta em vez de trancar a conta de quem não tem nada com a
   * visita.
   */
  const pessoa = await browser.newContext();
  if (visita !== undefined) await pessoa.addCookies([visita]);
  const pagina = await pessoa.newPage();
  const email = emailDeTeste('esquecida-outra-pessoa');
  await criarUsuarioConfirmado(email, 'Empresa Seguinte');
  await entrar(pagina, email);

  await expect(pagina.getByText('Você está vendo o painel de')).toHaveCount(0);
  await criarLojaPelaTela(pagina, 'Loja Depois da Visita', 'loja-depois-da-visita.com.br');
  await expect(pagina.getByText('Loja criada')).toBeVisible();
  expect((await pessoa.cookies()).some((cookie) => cookie.name === 'storefy_visita')).toBe(false);
});

/** Ciclo completo de loja: criar, alternar, editar e excluir. */
import { expect, test } from '@playwright/test';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  bancoDeTeste,
  criarLojaPelaTela,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
} from './apoio';
import { conectarShopify, webhookDoPedido } from './shopify-de-teste';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

test('cria duas lojas, alterna entre elas, edita e exclui uma', async ({ page }) => {
  const email = emailDeTeste('lojas');
  await criarUsuarioConfirmado(email, 'Empresa Lojas');
  await entrar(page, email);

  // Estado vazio guiando à primeira loja, sem número inventado.
  await expect(page.getByText('Nenhuma loja por aqui ainda')).toBeVisible();

  await page.getByRole('link', { name: 'Cadastrar minha primeira loja' }).click();
  await page.getByLabel('Nome da loja').fill('Loja Um');
  await page.getByLabel('Endereço da loja').fill('loja-um.com.br');
  await page.getByRole('button', { name: 'Criar loja' }).click();

  await expect(page.getByText('Loja criada')).toBeVisible();
  // A URL é normalizada para https mesmo sem o usuário digitar o esquema.
  await expect(page.getByText('https://loja-um.com.br')).toBeVisible();

  // Segunda loja.
  await page.goto('/lojas/nova');
  await page.getByLabel('Nome da loja').fill('Loja Dois');
  await page.getByLabel('Endereço da loja').fill('loja-dois.com.br');
  await page.getByRole('button', { name: 'Criar loja' }).click();
  await expect(page.getByText('Loja criada')).toBeVisible();

  // O seletor mostra a recém-criada como ativa e lista as duas.
  await page.getByRole('button', { name: 'Trocar de loja' }).click();
  await expect(page.getByRole('menuitem', { name: 'Loja Um' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Loja Dois' })).toBeVisible();

  await page.getByRole('menuitem', { name: 'Loja Um' }).click();
  await expect(page.getByRole('button', { name: 'Trocar de loja' })).toContainText('Loja Um');

  // Editar.
  await page.goto('/lojas');
  await page
    .getByRole('row', { name: /Loja Um/ })
    .getByRole('link', { name: 'Abrir' })
    .click();
  await page.getByLabel('Nome da loja').fill('Loja Um Renomeada');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Alterações salvas')).toBeVisible();

  // Excluir, sempre com confirmação.
  await page.getByRole('button', { name: 'Excluir loja' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Loja Um Renomeada');
  await page.getByRole('button', { name: 'Sim, excluir' }).click();

  await page.waitForURL(/\/lojas/);
  await expect(page.getByRole('cell', { name: 'Loja Um Renomeada' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Loja Dois' })).toBeVisible();
});

test('recusa endereço inválido com mensagem clara', async ({ page }) => {
  const email = emailDeTeste('url-invalida');
  await criarUsuarioConfirmado(email, 'Empresa URL');
  await entrar(page, email);

  await page.goto('/lojas/nova');
  await page.getByLabel('Nome da loja').fill('Loja Teste');
  await page.getByLabel('Endereço da loja').fill('nao-e-um-dominio');
  await page.getByRole('button', { name: 'Criar loja' }).click();

  await expect(page.getByText('Endereço inválido')).toBeVisible();
});

test('recusa duas lojas com o mesmo endereço na mesma empresa', async ({ page }) => {
  const email = emailDeTeste('url-duplicada');
  await criarUsuarioConfirmado(email, 'Empresa Duplicada');
  await entrar(page, email);

  for (const tentativa of [1, 2]) {
    await page.goto('/lojas/nova');
    await page.getByLabel('Nome da loja').fill(`Loja ${String(tentativa)}`);
    await page.getByLabel('Endereço da loja').fill('mesma-url.com.br');
    await page.getByRole('button', { name: 'Criar loja' }).click();
    if (tentativa === 1) await expect(page.getByText('Loja criada')).toBeVisible();
  }

  await expect(
    page.getByRole('alert').filter({ hasText: 'Já existe uma loja com este endereço' }),
  ).toBeVisible();
});

/*
 * O fuso existia no banco com "o lojista ajusta" no comentário da coluna — e
 * nenhuma tela para ajustar. Toda loja ficava presa no horário de Brasília:
 * agendamento, silêncio noturno e fechamento do dia.
 */
test('o fuso da loja se troca na tela, e a troca fica na auditoria', async ({ page }) => {
  const email = emailDeTeste('fuso');
  await criarUsuarioConfirmado(email, 'Empresa Fuso');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja do Norte', 'loja-do-norte.com.br');
  // O cadastro segue para o começo guiado; o fuso fica na página da loja.
  await page.goto(`/lojas/${lojaId}`);

  const campo = page.getByLabel('Fuso horário');
  await expect(campo).toHaveValue('America/Sao_Paulo');

  // O lojista escolhe pelo estado, e a lista diz a diferença para Brasília.
  await expect(campo.locator('option[value="America/Manaus"]')).toHaveText(
    'Amazonas (1 hora a menos que Brasília)',
  );
  await campo.selectOption('America/Manaus');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();

  await expect(page.getByText('Alterações salvas')).toBeVisible();
  await expect(page.getByLabel('Fuso horário')).toHaveValue('America/Manaus');

  const banco = bancoDeTeste();
  const { data: loja } = await banco.from('stores').select('timezone').eq('id', lojaId).single();
  expect(loja?.timezone).toBe('America/Manaus');

  const { data: trilha } = await banco
    .from('audit_logs')
    .select('diff')
    .eq('entity', 'stores')
    .eq('entity_id', lojaId)
    .eq('action', 'update');
  expect(JSON.stringify(trilha)).toContain('America/Manaus');
});

test('e-mail de atendimento recusado não apaga o que foi digitado', async ({ page }) => {
  const email = emailDeTeste('contato');
  await criarUsuarioConfirmado(email, 'Empresa Contato');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Contato', 'loja-contato.com.br');
  await page.goto(`/lojas/${lojaId}`);

  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail de atendimento').fill('atendimento@');
  await page.getByLabel('Fuso horário').selectOption('America/Rio_Branco');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();

  await expect(
    page.getByRole('alert').filter({ hasText: 'Digite um e-mail válido' }),
  ).toBeVisible();
  // O React limpava o campo ao fim da ação, erro ou não: a pessoa via a
  // mensagem embaixo de um campo que não tinha mais o que ela escreveu.
  await expect(page.getByLabel('E-mail de atendimento')).toHaveValue('atendimento@');
  await expect(page.getByLabel('Nome da loja')).toHaveValue('Loja Contato');
  /*
   * E o seletor, que é pior: num `<select>` o React só lê o `defaultValue` ao
   * montar, e a limpeza voltava o fuso para o de antes SEM AVISO. Corrigido o
   * e-mail, o "Salvar" gravaria o fuso antigo achando que gravou o novo.
   */
  await expect(page.getByLabel('Fuso horário')).toHaveValue('America/Rio_Branco');

  await page.getByLabel('E-mail de atendimento').fill('atendimento@loja-contato.com.br');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Alterações salvas')).toBeVisible();
  await expect(page.getByLabel('Fuso horário')).toHaveValue('America/Rio_Branco');
});

/*
 * O domínio `.myshopify.com` é por onde os webhooks acham a loja. Editar a
 * loja regravava o domínio com o host do site, e os pedidos de uma loja
 * conectada sumiam do painel depois de uma troca de e-mail. E outra
 * organização que pusesse o mesmo domínio no cadastro dela derrubava o
 * webhook da loja de verdade (migration 58).
 */
test('editar a loja conectada não desliga os pedidos, e outra empresa não os derruba', async ({
  page,
}) => {
  const email = emailDeTeste('loja-conectada');
  await criarUsuarioConfirmado(email, 'Empresa Conectada');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Conectada', 'loja-conectada.com.br');

  const dominio = `conectada-${String(Date.now())}.myshopify.com`;
  await conectarShopify(lojaId, dominio);

  // Troca o nome e o e-mail pela tela, como o lojista faria.
  await page.goto(`/lojas/${lojaId}`);
  await page.getByLabel('Nome da loja').fill('Loja Conectada Nova');
  await page.getByLabel('E-mail de atendimento').fill('oi@loja-conectada.com.br');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Alterações salvas.')).toBeVisible();

  const banco = bancoDeTeste();
  const { data: depois } = await banco
    .from('stores')
    .select('name, shop_domain')
    .eq('id', lojaId)
    .single();
  expect(depois).toEqual({ name: 'Loja Conectada Nova', shop_domain: dominio });

  const primeiro = await webhookDoPedido(page, dominio, { id: 7001, total: '50.00' });
  expect(primeiro).toEqual({ status: 200, corpo: { ok: true, feito: 'pedido', novo: true } });

  // Outra empresa põe o mesmo domínio no cadastro dela — o painel deixa, e
  // antes isso fazia todo webhook da loja de verdade levar 503.
  await page.context().clearCookies();
  const intruso = emailDeTeste('loja-intrusa');
  await criarUsuarioConfirmado(intruso, 'Empresa Intrusa');
  await entrar(page, intruso);
  const intrusaId = await criarLojaPelaTela(page, 'Loja Intrusa', 'loja-intrusa.com.br');
  const { error } = await banco.from('stores').update({ shop_domain: dominio }).eq('id', intrusaId);
  expect(error).toBeNull();

  const segundo = await webhookDoPedido(page, dominio, { id: 7002, total: '80.00' });
  expect(segundo).toEqual({ status: 200, corpo: { ok: true, feito: 'pedido', novo: true } });

  const { data: pedidos } = await banco
    .from('shop_orders')
    .select('shopify_order_id, apps!inner(store_id)')
    .in('shopify_order_id', ['7001', '7002']);
  expect(pedidos?.map((pedido) => pedido.apps.store_id)).toEqual([lojaId, lojaId]);
});

/*
 * A plataforma decide se o app marca o carrinho (a receita do app) e como os
 * links do app saem. Ela se escolhe no cadastro — a detecção sugere —, se
 * troca na edição, e chega ao rascunho do app sem o lojista precisar mexer no
 * editor. Com a Shopify conectada, o campo trava.
 */
test('a plataforma se escolhe no cadastro, troca na edição e chega ao app', async ({ page }) => {
  const email = emailDeTeste('plataforma');
  await criarUsuarioConfirmado(email, 'Empresa Plataforma');
  await entrar(page, email);

  await page.goto('/lojas/nova');
  await page.getByLabel('Nome da loja').fill('Loja Nuvem');
  await page.getByLabel('Endereço da loja').fill('loja-nuvem-e2e.com.br');
  const plataforma = page.getByLabel('Plataforma da loja');
  await expect(plataforma).toHaveValue('shopify');
  await plataforma.selectOption('other');
  await expect(
    page.getByText('não separa as vendas do app das do site', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Criar loja' }).click();
  await page.waitForURL(/\/lojas\/[0-9a-f-]{36}\/comecar$/);
  const lojaId = /\/lojas\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';

  const banco = bancoDeTeste();
  const lerLoja = async () =>
    (await banco.from('stores').select('platform').eq('id', lojaId).single()).data;
  const lerRascunho = async () => {
    const { data: app } = await banco.from('apps').select('id').eq('store_id', lojaId).single();
    const { data } = await banco
      .from('app_configs')
      .select('config')
      .eq('app_id', app?.id ?? '')
      .eq('status', 'draft')
      .single();
    return (data?.config as { store: { platform: string } } | undefined)?.store.platform;
  };

  expect(await lerLoja()).toEqual({ platform: 'other' });
  expect(await lerRascunho()).toBe('other');

  // Troca na edição; o rascunho acompanha quando o editor abre.
  await page.goto(`/lojas/${lojaId}`);
  await expect(page.getByLabel('Plataforma da loja')).toHaveValue('other');
  await page.getByLabel('Plataforma da loja').selectOption('shopify');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Alterações salvas.')).toBeVisible();
  expect(await lerLoja()).toEqual({ platform: 'shopify' });

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Editor do app' })).toBeVisible();
  expect(await lerRascunho()).toBe('shopify');

  // Conectada à Shopify: o campo trava, e diz o que fazer.
  await conectarShopify(lojaId, `plataforma-${String(Date.now())}.myshopify.com`);
  await page.goto(`/lojas/${lojaId}`);
  await expect(page.getByLabel('Plataforma da loja')).toBeDisabled();
  await expect(
    page.getByText(
      'A loja está conectada à Shopify. Para trocar a plataforma, desconecte em Integrações.',
    ),
  ).toBeVisible();

  // Salvar o resto não mexe na plataforma travada.
  await page.getByLabel('Nome da loja').fill('Loja Nuvem Conectada');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Alterações salvas.')).toBeVisible();
  expect(await lerLoja()).toEqual({ platform: 'shopify' });
});

/**
 * As automações de push (C09), pela tela.
 *
 * Este teste nasceu de um defeito: o "estreitador" de tipo da ação de salvar
 * foi escrito quando só existiam boas-vindas e carrinho abandonado, e gravava
 * TODA automação nova como carrinho abandonado. Ligar "Pedido enviado" ou "De
 * volta ao estoque" reescrevia o texto do carrinho — e as duas nunca ligavam.
 * Sem um teste que ligasse cada uma pela tela e olhasse o banco, ninguém viu.
 */
import { expect, test, type Page } from '@playwright/test';
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

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

const AUTOMACOES = [
  { tipo: 'welcome', nome: 'Boas-vindas', titulo: 'Bem-vindo!' },
  { tipo: 'abandoned_cart', nome: 'Carrinho abandonado', titulo: 'Esqueceu algo?' },
  { tipo: 'order_shipped', nome: 'Pedido enviado', titulo: 'Seu pedido saiu para entrega' },
  { tipo: 'back_in_stock', nome: 'De volta ao estoque', titulo: 'Voltou!' },
  {
    tipo: 'inactive_7d',
    nome: 'Sentimos sua falta',
    titulo: 'Faz tempo que você não passa por aqui',
  },
  {
    tipo: 'custom_webhook',
    nome: 'Klaviyo, Omnisend e outras ferramentas',
    titulo: 'Tem novidade para você',
  },
] as const;

async function automacoesNoBanco(lojaId: string) {
  const { data: app } = await bancoDeTeste()
    .from('apps')
    .select('id')
    .eq('store_id', lojaId)
    .single();
  if (app == null) throw new Error('A loja de teste ficou sem app.');
  const { data, error } = await bancoDeTeste()
    .from('push_automations')
    .select('type, enabled, title, delay_minutes')
    .eq('app_id', app.id)
    .order('type');
  if (error != null) throw new Error(error.message);
  return data;
}

function cartao(page: Page, nome: string) {
  return page.getByRole('region', { name: nome, exact: true });
}

test('cada automação liga com o próprio tipo, e o "sentimos sua falta" escolhe a hora', async ({
  page,
}) => {
  const email = emailDeTeste('automacoes');
  await criarUsuarioConfirmado(email, 'Empresa Automações');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Automações', 'loja-automacoes.com.br');

  await page.goto('/push/automacoes');
  await page.waitForLoadState('networkidle');

  // Liga uma por uma, pela chave de cada card.
  for (const { nome } of AUTOMACOES) {
    await cartao(page, nome)
      .getByRole('switch', { name: `Ligar ${nome}` })
      .click();
    await expect(page.getByText(`Automação “${nome}” ligada.`)).toBeVisible();
    await expect(
      cartao(page, nome).getByRole('switch', { name: `Desligar ${nome}` }),
    ).toBeChecked();
  }

  // No banco, uma linha por automação — cada uma com o SEU tipo e o SEU texto.
  const ligadas = await automacoesNoBanco(lojaId);
  expect(ligadas.map((linha) => linha.type).sort()).toEqual(
    AUTOMACOES.map((automacao) => automacao.tipo).sort(),
  );
  for (const { tipo, titulo } of AUTOMACOES) {
    const linha = ligadas.find((automacao) => automacao.type === tipo);
    expect(linha, tipo).toMatchObject({ enabled: true, title: titulo });
  }

  // O "sentimos sua falta" diz QUANDO sai, e a hora se escolhe no 7º dia.
  const inativo = cartao(page, 'Sentimos sua falta');
  await expect(inativo.getByText('Ligada · envia no 7º dia sem abrir o app, às 10h')).toBeVisible();
  await inativo.getByRole('button', { name: 'Editar mensagem' }).click();
  const horario = inativo.getByLabel('Horário do envio, no 7º dia');
  await expect(horario.locator('option')).toHaveText([
    'Às 8h',
    'Às 10h',
    'Às 12h',
    'Às 15h',
    'Às 18h',
    'Às 20h',
  ]);
  await horario.selectOption({ label: 'Às 12h' });
  await inativo.getByRole('button', { name: 'Salvar mensagem' }).click();
  await expect(inativo.getByText('Ligada · envia no 7º dia sem abrir o app, às 12h')).toBeVisible();
  expect(
    (await automacoesNoBanco(lojaId)).find((linha) => linha.type === 'inactive_7d')?.delay_minutes,
  ).toBe(720);

  // Desligar uma não mexe nas outras — em especial no carrinho abandonado.
  await cartao(page, 'Pedido enviado')
    .getByRole('switch', { name: 'Desligar Pedido enviado' })
    .click();
  await expect(page.getByText('Automação “Pedido enviado” desligada.')).toBeVisible();
  const depois = await automacoesNoBanco(lojaId);
  expect(depois.find((linha) => linha.type === 'order_shipped')?.enabled).toBe(false);
  expect(depois.find((linha) => linha.type === 'abandoned_cart')).toMatchObject({
    enabled: true,
    title: 'Esqueceu algo?',
  });
});

/*
 * O webhook (C09 e C14): gerar a chave, a ferramenta chamando com a
 * automação desligada e ligada, o mesmo evento repetido, a troca que derruba a
 * chave velha e a desativação — pela tela, com o endereço chamado de verdade.
 */
const WEBHOOK = 'Klaviyo, Omnisend e outras ferramentas';

async function appDaLoja(lojaId: string): Promise<string> {
  const { data, error } = await bancoDeTeste()
    .from('apps')
    .select('id')
    .eq('store_id', lojaId)
    .single();
  if (error != null) throw new Error(error.message);
  return data.id;
}

async function chaveMostrada(page: Page): Promise<string> {
  const caixa = page.getByRole('status').filter({ hasText: 'Sua chave nova' });
  await expect(caixa).toBeVisible();
  const chave = (await caixa.locator('pre').textContent())?.trim() ?? '';
  expect(chave).toMatch(/^sfy_wh_[A-Za-z0-9_-]{43}$/);
  return chave;
}

test('a chave do webhook: gerar, receber, trocar e desativar', async ({ page }) => {
  const email = emailDeTeste('webhook');
  const usuario = await criarUsuarioConfirmado(email, 'Empresa Webhook');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Webhook', 'loja-webhook.com.br');
  const appId = await appDaLoja(lojaId);

  /*
   * O cliente com o app instalado, que entrou na conta dele: é o app quem
   * registra o aparelho (pelo endpoint assinado), e o painel não tem como.
   * A função é a mesma que o endpoint chama.
   */
  const { error: erroDoAparelho } = await bancoDeTeste().rpc('registrar_aparelho', {
    p_app_id: appId,
    p_subscription: 'inscricao-do-cliente-4242',
    p_platform: 'ios',
    p_external_id: '4242',
  });
  if (erroDoAparelho != null) throw new Error(erroDoAparelho.message);

  await page.goto('/push/automacoes');
  await page.waitForLoadState('networkidle');
  const card = cartao(page, WEBHOOK);

  await expect(card.getByText('Nenhuma chave ainda.', { exact: false })).toBeVisible();
  const endereco = new URL('/api/webhooks/automacao', page.url()).toString();
  await expect(card.getByText(endereco, { exact: true })).toBeVisible();

  // Gerar: a chave aparece UMA vez, e o banco guarda só o hash e a dica.
  await card.getByRole('button', { name: 'Gerar chave' }).click();
  await expect(page.getByText('Chave gerada. Copie agora: ela não aparece de novo.')).toBeVisible();
  const chave = await chaveMostrada(page);
  await expect(card.getByText(`••••${chave.slice(-4)}`)).toBeVisible();

  const { data: gravada } = await bancoDeTeste()
    .from('automation_webhooks')
    .select('token_hint, token_hash, created_by, received_count')
    .eq('app_id', appId)
    .single();
  expect(gravada).toMatchObject({
    token_hint: chave.slice(-4),
    created_by: usuario,
    received_count: 0,
  });
  expect(gravada?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(gravada?.token_hash).not.toContain(chave);

  // A automação nasce desligada, com o texto sugerido.
  const { data: automacao } = await bancoDeTeste()
    .from('push_automations')
    .select('id, enabled, title')
    .eq('app_id', appId)
    .eq('type', 'custom_webhook')
    .single();
  expect(automacao).toMatchObject({ enabled: false, title: 'Tem novidade para você' });

  /*
   * Do navegador, na mesma origem: o `app.localhost` do teste só resolve no
   * Chromium, e não no processo do Playwright. A rota não olha sessão nem
   * cookie — quem chama de verdade é o servidor do Klaviyo.
   */
  const chamar = (comChave: string, corpo: Record<string, unknown>) =>
    page.evaluate(
      async ({ chaveUsada, corpoEnviado }) => {
        const resposta = await fetch('/api/webhooks/automacao', {
          method: 'POST',
          headers: { Authorization: `Bearer ${chaveUsada}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(corpoEnviado),
        });
        return {
          status: resposta.status,
          corpo: (await resposta.json()) as Record<string, unknown>,
        };
      },
      { chaveUsada: comChave, corpoEnviado: corpo },
    );

  // Desligada: a ferramenta ouve onde ligar, e a tela mostra que ela chamou.
  const desligada = await chamar(chave, { customerId: '4242', title: 'Oi do Klaviyo' });
  expect(desligada.status).toBe(403);
  expect(desligada.corpo).toMatchObject({ erro: 'automacao_desligada' });

  await page.reload();
  await expect(
    card.getByText('A sua ferramenta está chamando, mas a automação está desligada', {
      exact: false,
    }),
  ).toBeVisible();

  await card.getByRole('switch', { name: `Ligar ${WEBHOOK}` }).click();
  await expect(page.getByText(`Automação “${WEBHOOK}” ligada.`)).toBeVisible();
  await expect(card.getByText('Ligada · envia assim que a sua ferramenta chama')).toBeVisible();

  // Ligada: o push é agendado para o aparelho do cliente, com o texto do chamado.
  const ligada = await chamar(chave, {
    customerId: 'gid://shopify/Customer/4242',
    title: 'Oi do Klaviyo',
    deepLink: '/collections/novidades',
    id: 'evento-1',
  });
  expect(ligada.status).toBe(202);
  expect(ligada.corpo).toEqual({ recebido: true, aparelhos: 1 });

  const repetida = await chamar(chave, { customerId: '4242', id: 'evento-1' });
  expect(repetida.corpo).toEqual({ recebido: true, aparelhos: 0 });

  const { data: envios } = await bancoDeTeste()
    .from('automation_runs')
    .select('trigger_ref, title, body, deep_link, status')
    .eq('automation_id', automacao?.id ?? '');
  expect(envios).toEqual([
    {
      trigger_ref: 'webhook:evento-1',
      title: 'Oi do Klaviyo',
      body: null,
      deep_link: '/collections/novidades',
      status: 'scheduled',
    },
  ]);

  await page.reload();
  await expect(card.getByText('Avisos recebidos')).toBeVisible();
  await expect(card.locator('dd').filter({ hasText: /^3$/ })).toBeVisible();

  // Trocar: pede confirmação, a velha para na hora e a nova vale.
  await card.getByRole('button', { name: 'Gerar chave nova' }).click();
  const troca = page.getByRole('alertdialog', { name: 'Gerar uma chave nova?' });
  await expect(troca).toBeVisible();
  await troca.getByRole('button', { name: 'Gerar chave nova' }).click();
  const nova = await chaveMostrada(page);
  expect(nova).not.toBe(chave);

  const velha = await chamar(chave, { customerId: '4242' });
  expect(velha.status).toBe(401);
  expect(velha.corpo).toMatchObject({
    mensagem: 'Esta chave não vale mais. Gere outra no painel da Storefy.',
  });
  expect((await chamar(nova, { customerId: '4242' })).status).toBe(202);

  await page.getByRole('button', { name: 'Já guardei' }).click();
  await expect(page.getByText('Sua chave nova')).toHaveCount(0);

  // Desativar: pede confirmação e derruba a chave.
  await card.getByRole('button', { name: 'Desativar chave' }).click();
  const desativar = page.getByRole('alertdialog', { name: 'Desativar a chave?' });
  await desativar.getByRole('button', { name: 'Desativar' }).click();
  await expect(
    page.getByText('Chave desativada. A ferramenta que usava esta chave para de funcionar.'),
  ).toBeVisible();
  await expect(card.getByText('Nenhuma chave ainda.', { exact: false })).toBeVisible();
  expect((await chamar(nova, { customerId: '4242' })).status).toBe(401);

  // A trilha: gerar, trocar e desativar, em nome de quem fez — e sem o hash.
  const { data: trilha } = await bancoDeTeste()
    .from('audit_logs')
    .select('action, actor_id, diff')
    .eq('entity', 'automation_webhooks')
    .eq('entity_id', automacao?.id ?? '')
    .order('created_at');
  expect(trilha?.map((linha) => linha.action)).toEqual(['create', 'update', 'delete']);
  expect(trilha?.every((linha) => linha.actor_id === usuario)).toBe(true);
  expect(JSON.stringify(trilha)).not.toContain('token_hash');

  // Na C14, o cartão diz o estado e leva à automação.
  await page.goto('/integracoes');
  const integracao = page.getByRole('region', { name: WEBHOOK });
  await expect(integracao.getByText('Não conectada')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Meta Pixel (Facebook e Instagram)' }),
  ).toBeVisible();
  await integracao.getByRole('link', { name: 'Conectar na automação' }).click();
  await page.waitForURL(/\/push\/automacoes/);
  await expect(cartao(page, WEBHOOK)).toBeVisible();
});

test('quem é membro vê a chave, mas não gera nem troca', async ({ page }) => {
  const dono = emailDeTeste('webhook-dono');
  await criarUsuarioConfirmado(dono, 'Empresa Webhook Membro');
  await entrar(page, dono);
  const lojaId = await criarLojaPelaTela(page, 'Loja Webhook Membro', 'loja-webhook-membro.com.br');

  await page.goto('/push/automacoes');
  await cartao(page, WEBHOOK).getByRole('button', { name: 'Gerar chave' }).click();
  const chave = await chaveMostrada(page);

  // Um membro na mesma empresa.
  const membro = emailDeTeste('webhook-membro');
  const membroId = await criarUsuarioConfirmado(membro, 'Pessoal Membro');
  const { data: loja } = await bancoDeTeste()
    .from('stores')
    .select('org_id')
    .eq('id', lojaId)
    .single();
  const { error } = await bancoDeTeste()
    .from('memberships')
    .insert({ org_id: loja?.org_id ?? '', user_id: membroId, role: 'member' });
  if (error != null) throw new Error(error.message);

  await page.context().clearCookies();
  await entrar(page, membro);
  await page.goto('/push/automacoes');
  const card = cartao(page, WEBHOOK);
  await expect(card.getByText(`••••${chave.slice(-4)}`)).toBeVisible();
  await expect(
    card.getByText('Só quem é proprietário ou administrador gera e troca a chave.'),
  ).toBeVisible();
  await expect(card.getByRole('button', { name: /Gerar chave|Desativar chave/ })).toHaveCount(0);
});

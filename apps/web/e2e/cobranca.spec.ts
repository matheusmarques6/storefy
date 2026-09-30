/**
 * Fase 7 — a cobrança de ponta a ponta: a equipe publica os planos (A09), o
 * lojista assina pela C15, a Asaas avisa o pagamento, ele troca de plano e
 * cancela; e, quando o teste acaba, o painel avisa, trava o que custa e a
 * equipe estende o teste pela ficha do cliente (A04).
 *
 * A Asaas é o servidor de `asaas-de-teste.ts`, na própria máquina: o painel
 * fala HTTP com ele exatamente como falaria com a Asaas.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { AsaasDeTeste } from './asaas-de-teste';
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

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);

const CHAVE = process.env.ASAAS_API_KEY ?? '';
const TOKEN = process.env.ASAAS_WEBHOOK_TOKEN ?? '';
test.skip(
  CHAVE === '' || TOKEN === '',
  'Rode pelo scripts/e2e-local.sh: ele liga o painel com a Asaas de teste.',
);

const PORTA_DA_ASAAS = Number(process.env.PORTA_DA_ASAAS_DE_TESTE ?? '4010');
const PAINEL = new URL(process.env.E2E_BASE_URL ?? 'http://app.localhost:3000');
// O aviso da Asaas chega pelo endereço da máquina: o `*.localhost` é coisa
// do navegador, e este pedido sai do Node.
const ENDERECO_DO_AVISO = `http://127.0.0.1:${PAINEL.port === '' ? '80' : PAINEL.port}/api/webhooks/asaas`;

const asaas = new AsaasDeTeste(PORTA_DA_ASAAS, CHAVE);
const sufixo = Math.random().toString(36).slice(2, 7);
const ESSENCIAL = `E2E Essencial ${sufixo}`;
const CRESCIMENTO = `E2E Crescimento ${sufixo}`;
const CONFERIDO = `E2E Conferido ${sufixo}`;
const equipeDeTeste: string[] = [];

test.beforeAll(async () => {
  await asaas.ligar();
});

test.afterAll(async () => {
  await asaas.desligar();
  await limparUsuariosDeTeste();
  // Planos são da plataforma, e não de uma empresa: saem aqui, com a trilha.
  const banco = bancoDeTeste();
  const { data: planos } = await banco
    .from('plans')
    .select('id')
    .in('nome', [ESSENCIAL, CRESCIMENTO, CONFERIDO]);
  const ids = (planos ?? []).map((plano) => plano.id);
  if (ids.length > 0) {
    await banco.from('plans').delete().in('id', ids);
    await banco.from('audit_logs').delete().eq('entity', 'plans').in('entity_id', ids);
  }
  if (equipeDeTeste.length > 0) {
    await banco.from('audit_logs').delete().in('actor_id', equipeDeTeste);
  }
  // O aviso fica mesmo quando a empresa sai (é o registro do que chegou): o
  // do teste sai aqui.
  await banco.from('billing_events').delete().like('external_id', `%_${sufixo}`);
});

async function novaPagina(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

async function orgDe(userId: string): Promise<string> {
  const { data } = await bancoDeTeste()
    .from('memberships')
    .select('org_id')
    .eq('user_id', userId)
    .single();
  return data?.org_id ?? '';
}

/** Uma data "AAAA-MM-DD" em Brasília, a partir de um instante. */
function diaEmBrasilia(instante: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(instante);
}

function dia(texto: string): string {
  const [ano, mes, d] = texto.split('-');
  return `${d ?? ''}/${mes ?? ''}/${ano ?? ''}`;
}

async function superadmin(browser: Browser, rotulo: string): Promise<{ pagina: Page; id: string }> {
  const pagina = await novaPagina(browser);
  const email = emailDeTeste(rotulo);
  const id = await criarUsuarioConfirmado(email, `Equipe ${rotulo}`);
  equipeDeTeste.push(id);
  await tornarPlatformAdmin(id);
  await entrar(pagina, email);
  return { pagina, id };
}

async function avisar(corpo: object, token = TOKEN): Promise<{ status: number; corpo: unknown }> {
  const resposta = await fetch(ENDERECO_DO_AVISO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'asaas-access-token': token },
    body: JSON.stringify(corpo),
  });
  return { status: resposta.status, corpo: await resposta.json() };
}

test('a equipe publica os planos; o lojista assina, paga, troca de plano e cancela', async ({
  page,
  browser,
}) => {
  // --------------------------------------------------------- A09: os planos
  const equipe = await superadmin(browser, 'cob-equipe');
  await equipe.pagina.goto('/admin/planos');
  await equipe.pagina.getByLabel('Nome', { exact: true }).fill(ESSENCIAL);
  await equipe.pagina.getByLabel('Preço por mês (R$)').fill('4,99');
  await equipe.pagina.getByRole('button', { name: 'Criar plano' }).click();
  await expect(equipe.pagina.getByText('O preço vai de R$ 5,00')).toBeVisible();
  await expect(equipe.pagina.getByLabel('Nome', { exact: true })).toHaveValue(ESSENCIAL);

  await equipe.pagina.getByLabel('Preço por mês (R$)').fill('99,90');
  await equipe.pagina.getByLabel('Lojas', { exact: true }).fill('2');
  await equipe.pagina.getByLabel('Campanhas por mês').fill('30');
  await equipe.pagina.getByRole('button', { name: 'Criar plano' }).click();
  await expect(equipe.pagina.getByText(`Plano ${ESSENCIAL} criado.`)).toBeVisible();
  // O formulário volta limpo para o próximo.
  await expect(equipe.pagina.getByLabel('Nome', { exact: true })).toHaveValue('');

  await equipe.pagina.getByLabel('Nome', { exact: true }).fill(CRESCIMENTO);
  await equipe.pagina.getByLabel('Preço por mês (R$)').fill('199,90');
  await equipe.pagina.getByRole('button', { name: 'Criar plano' }).click();
  await expect(equipe.pagina.getByText(`Plano ${CRESCIMENTO} criado.`)).toBeVisible();
  await expect(equipe.pagina.getByRole('row', { name: new RegExp(ESSENCIAL) })).toContainText(
    'Até 2 lojas',
  );

  // -------------------------------------------------- C15: o lojista assina
  const emailDono = emailDeTeste('cob-dono');
  const donoId = await criarUsuarioConfirmado(emailDono, 'Loja da Cobrança');
  const orgId = await orgDe(donoId);
  await entrar(page, emailDono);

  await page.getByRole('button', { name: 'Menu da conta' }).click();
  await page.getByRole('menuitem', { name: 'Plano e cobrança' }).click();
  await page.waitForURL('/configuracoes/plano');
  await expect(page.getByText('Teste grátis', { exact: true })).toBeVisible();
  await expect(page.getByText('Faltam 14 dias')).toBeVisible();

  const cartaoEssencial = page.getByRole('listitem').filter({ hasText: ESSENCIAL });
  await cartaoEssencial.getByRole('button', { name: `Assinar ${ESSENCIAL}` }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByRole('button', { name: 'Assinar', exact: true }).click();
  await expect(dialogo.getByText('com pelo menos 2 letras')).toBeVisible();
  await expect(dialogo.getByText('CPF ou CNPJ inválido. Confira os números.')).toBeVisible();

  await dialogo.getByLabel('Nome ou razão social').fill('Loja da Cobrança Ltda');
  await dialogo.getByLabel('CPF ou CNPJ').fill('11.222.333/0001-80');
  await dialogo.getByLabel('E-mail que recebe as faturas').fill('financeiro@cobranca.test');
  await dialogo.getByRole('button', { name: 'Assinar', exact: true }).click();
  // O sinal de que ESTE envio voltou: o erro do nome some; o do CNPJ fica.
  await expect(dialogo.getByText('com pelo menos 2 letras')).toHaveCount(0);
  await expect(dialogo.getByText('CPF ou CNPJ inválido. Confira os números.')).toBeVisible();
  await expect(dialogo.getByLabel('Nome ou razão social')).toHaveValue('Loja da Cobrança Ltda');
  expect(asaas.pedidos).toHaveLength(0);

  await dialogo.getByLabel('CPF ou CNPJ').fill('11.222.333/0001-81');
  await dialogo.getByRole('button', { name: 'Assinar', exact: true }).click();
  await expect(dialogo.getByRole('heading', { name: 'Assinatura criada' })).toBeVisible();

  // A primeira cobrança vence no fim do teste: quem assina cedo não perde dias.
  const { data: org } = await bancoDeTeste()
    .from('organizations')
    .select('trial_ends_at')
    .eq('id', orgId)
    .single();
  const fimDoTeste = diaEmBrasilia(new Date(org?.trial_ends_at ?? ''));
  await expect(dialogo).toContainText(
    `A primeira fatura vence em ${dia(fimDoTeste)}, no fim do teste.`,
  );

  const pagamento = asaas.pagamentos[0];
  expect(pagamento).toBeDefined();
  await expect(dialogo.getByRole('link', { name: 'Abrir a fatura' })).toHaveAttribute(
    'href',
    pagamento?.invoiceUrl ?? '',
  );
  const cliente = asaas.pedidos.find((p) => p.metodo === 'POST' && p.caminho === '/customers');
  expect(cliente?.chave).toBe(CHAVE);
  expect(cliente?.corpo).toMatchObject({
    name: 'Loja da Cobrança Ltda',
    cpfCnpj: '11222333000181',
    email: 'financeiro@cobranca.test',
    externalReference: orgId,
  });
  const assinatura = asaas.pedidos.find(
    (p) => p.metodo === 'POST' && p.caminho === '/subscriptions',
  );
  expect(assinatura?.corpo).toMatchObject({
    billingType: 'UNDEFINED',
    value: 99.9,
    cycle: 'MONTHLY',
    nextDueDate: fimDoTeste,
  });

  await dialogo.getByRole('button', { name: 'Pronto' }).click();
  await expect(
    page.getByText(new RegExp(`Plano ${ESSENCIAL} · R\\$\\s99,90 por mês`)),
  ).toBeVisible();
  await expect(page.getByText('Aguardando o primeiro pagamento')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Aguardando pagamento' })).toBeVisible();
  await expect(page.getByText('CNPJ final 0181')).toBeVisible();
  // O documento inteiro não fica no painel.
  const { data: quemPaga } = await bancoDeTeste()
    .from('billing_customers')
    .select('*')
    .eq('org_id', orgId)
    .single();
  expect(JSON.stringify(quemPaga)).not.toContain('11222333000181');

  // ------------------------------------------ a Asaas avisa que foi pago
  const aviso = {
    id: `evt_e2e_${sufixo}`,
    event: 'PAYMENT_RECEIVED',
    dateCreated: '2026-09-29 10:00:00',
    payment: {
      object: 'payment',
      id: pagamento?.id,
      subscription: pagamento?.subscription,
      customer: pagamento?.customer,
      value: pagamento?.value,
      status: 'RECEIVED',
      dueDate: pagamento?.dueDate,
      clientPaymentDate: diaEmBrasilia(new Date()),
      invoiceUrl: pagamento?.invoiceUrl,
    },
  };
  expect((await avisar(aviso, 'token-errado-mas-comprido')).status).toBe(401);
  expect(await avisar(aviso)).toEqual({ status: 200, corpo: { ok: true, resultado: 'aplicado' } });
  expect(await avisar(aviso)).toEqual({ status: 200, corpo: { ok: true, resultado: 'repetido' } });
  expect(
    await avisar({ id: `evt_outro_${sufixo}`, event: 'TRANSFER_DONE', dateCreated: 'x' }),
  ).toMatchObject({ status: 200, corpo: { ignorado: 'evento TRANSFER_DONE' } });

  await page.reload();
  await expect(page.getByText('Em dia', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Pago até \d{2}\/\d{2}\/\d{4}\.$/)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Paga' })).toBeVisible();

  // ----------------------------------------------------- trocar de plano
  const cartaoCrescimento = page.getByRole('listitem').filter({ hasText: CRESCIMENTO });
  await cartaoCrescimento.getByRole('button', { name: 'Mudar para este plano' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('R$');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Mudar de plano' }).click();
  await expect(page.getByText(`Plano trocado para ${CRESCIMENTO}.`)).toBeVisible();
  await expect(
    page.getByText(new RegExp(`Plano ${CRESCIMENTO} · R\\$\\s199,90 por mês`)),
  ).toBeVisible();
  const troca = asaas.pedidos.find(
    (p) => p.metodo === 'PUT' && p.caminho.startsWith('/subscriptions/'),
  );
  expect(troca?.corpo).toMatchObject({ value: 199.9, updatePendingPayments: true });

  // ------------------------------------------------------------ cancelar
  await page.getByRole('button', { name: 'Cancelar assinatura' }).click();
  const confirmacao = page.getByRole('alertdialog');
  await expect(confirmacao).toContainText('O que já foi pago vale até');
  await expect(confirmacao).toContainText('O app continua funcionando');
  await confirmacao.getByRole('button', { name: 'Manter assinatura' }).click();
  await expect(page.getByText('Em dia', { exact: true })).toBeVisible();
  expect(asaas.pedidos.some((p) => p.metodo === 'DELETE')).toBe(false);

  await page.getByRole('button', { name: 'Cancelar assinatura' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar assinatura' }).click();
  await expect(
    page.getByText('Assinatura cancelada. Nenhuma fatura nova será gerada.'),
  ).toBeVisible();
  expect(asaas.pedidos.some((p) => p.metodo === 'DELETE')).toBe(true);
  await expect(page.getByText('Cancelada', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Cancelada\. O que já foi pago vale até/)).toBeVisible();
  // Pago, e ainda no período: nada travou.
  await expect(page.getByText('estão parados')).toHaveCount(0);

  // -------------------------------------------- A04: a ficha do cliente
  await equipe.pagina.goto(`/admin/organizacoes/${orgId}`);
  const cobranca = equipe.pagina.getByRole('region', { name: /Cobrança/ });
  await expect(cobranca.getByText('Liberado', { exact: true })).toBeVisible();
  await expect(cobranca.getByText('PAYMENT_RECEIVED')).toBeVisible();
  await expect(cobranca.getByText('CNPJ final 0181', { exact: false })).toBeVisible();

  // ---------------------------------------------------------- a trilha
  const { data: trilha } = await bancoDeTeste()
    .from('audit_logs')
    .select('entity, diff')
    .eq('org_id', orgId)
    .eq('actor_id', donoId)
    .eq('entity', 'subscriptions')
    .order('created_at');
  expect(trilha?.map((linha) => Object.keys(linha.diff as object).sort())).toEqual([
    ['plano', 'valor_centavos'],
    ['plano', 'valor_centavos'],
    ['cancelada'],
  ]);
});

test('o teste acaba: o painel avisa, trava o que custa, e a equipe estende o teste', async ({
  page,
  browser,
}) => {
  const emailDono = emailDeTeste('cob-fim');
  const donoId = await criarUsuarioConfirmado(emailDono, 'Loja sem Teste');
  const orgId = await orgDe(donoId);
  // O tempo passando não tem tela: o fim do teste é o único dado ajustado no banco.
  await bancoDeTeste()
    .from('organizations')
    .update({ trial_ends_at: new Date(Date.now() - 2 * 86_400_000).toISOString() })
    .eq('id', orgId);

  await entrar(page, emailDono);
  const faixa = page.getByRole('alert').filter({ hasText: 'O período de teste acabou.' });
  await expect(faixa).toContainText('O app continua funcionando para os seus clientes.');
  await expect(faixa.getByRole('link', { name: 'Escolher um plano' })).toHaveAttribute(
    'href',
    '/configuracoes/plano',
  );

  await page.goto('/lojas/nova');
  await page.getByLabel('Nome da loja').fill('Loja Travada');
  await page.getByLabel('Endereço da loja').fill('loja-travada.com.br');
  await page.getByRole('button', { name: 'Criar loja' }).click();
  await expect(
    page.getByText(
      'O período de teste acabou. Assine um plano em Configurações › Plano e cobrança para cadastrar lojas.',
    ),
  ).toBeVisible();

  await page.goto('/configuracoes/plano');
  await expect(page.getByText('Acabou', { exact: true })).toBeVisible();
  await expect(page.getByText(/estão parados/).first()).toBeVisible();

  // A equipe estende o teste pela ficha do cliente.
  const equipe = await superadmin(browser, 'cob-estende');
  await equipe.pagina.goto(`/admin/organizacoes/${orgId}`);
  const cobranca = equipe.pagina.getByRole('region', { name: /Cobrança/ });
  await expect(cobranca.getByText('Travado', { exact: true })).toBeVisible();
  const ate = diaEmBrasilia(new Date(Date.now() + 10 * 86_400_000));
  await cobranca.getByLabel('Teste até').fill(ate);
  await cobranca.getByRole('button', { name: 'Estender teste' }).click();
  await expect(cobranca.getByText(`Teste estendido até ${dia(ate)}.`)).toBeVisible();
  await equipe.pagina.reload();
  await expect(
    equipe.pagina.getByRole('region', { name: /Cobrança/ }).getByText('Liberado', { exact: true }),
  ).toBeVisible();

  // O lojista volta a ter tudo: a faixa some e a loja nova entra.
  await page.goto('/');
  await expect(page.getByText('O período de teste acabou.')).toHaveCount(0);
  await criarLojaPelaTela(page, 'Loja Liberada', 'loja-liberada.com.br');

  const { data: trilha } = await bancoDeTeste()
    .from('audit_logs')
    .select('actor_id, diff')
    .eq('org_id', orgId)
    .eq('entity', 'organizations')
    .eq('actor_id', equipe.id);
  expect(trilha?.some((linha) => 'trial_ends_at' in (linha.diff as object))).toBe(true);
});

test('o aviso do pagamento não chega: o lojista confere na hora, e a equipe também', async ({
  page,
  browser,
}) => {
  // Um plano só deste teste, para ele não depender da ordem dos outros.
  const { error: erroDoPlano } = await bancoDeTeste()
    .from('plans')
    .insert({ nome: CONFERIDO, preco_centavos: 5990, disponivel: true });
  if (erroDoPlano != null) throw new Error(erroDoPlano.message);

  const emailDono = emailDeTeste('cob-conferencia');
  const donoId = await criarUsuarioConfirmado(emailDono, 'Loja da Conferência');
  const orgId = await orgDe(donoId);
  await entrar(page, emailDono);
  await page.goto('/configuracoes/plano');

  const cartao = page.getByRole('listitem').filter({ hasText: CONFERIDO });
  await cartao.getByRole('button', { name: `Assinar ${CONFERIDO}` }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Nome ou razão social').fill('Loja da Conferência Ltda');
  await dialogo.getByLabel('CPF ou CNPJ').fill('11.222.333/0001-81');
  await dialogo.getByLabel('E-mail que recebe as faturas').fill('financeiro@conferencia.test');
  await dialogo.getByRole('button', { name: 'Assinar', exact: true }).click();
  await expect(dialogo.getByRole('heading', { name: 'Assinatura criada' })).toBeVisible();
  await dialogo.getByRole('button', { name: 'Pronto' }).click();

  const { data: assinatura } = await bancoDeTeste()
    .from('subscriptions')
    .select('external_id')
    .eq('org_id', orgId)
    .single();
  const pagamento = asaas.pagamentos.find((p) => p.subscription === assinatura?.external_id);
  expect(pagamento).toBeDefined();

  // Ainda não pago: a conferência diz isso, sem erro e sem mudar nada.
  const conferir = page.getByRole('button', { name: 'Já paguei, conferir' });
  await conferir.click();
  await expect(
    page.getByText('A Asaas ainda não recebeu o pagamento.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Aguardando pagamento' })).toBeVisible();

  // Pago na Asaas, e o aviso nunca chega (a fila de avisos pausada).
  if (pagamento !== undefined) {
    pagamento.status = 'RECEIVED';
    pagamento.clientPaymentDate = diaEmBrasilia(new Date());
  }
  await conferir.click();
  await expect(page.getByText('Pagamento confirmado pela Asaas. Obrigado!')).toBeVisible();
  await expect(page.getByText('Em dia', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Paga' })).toBeVisible();
  // Sem fatura em aberto, não há o que conferir.
  await expect(conferir).toHaveCount(0);
  const leituras = asaas.pedidos.filter(
    (p) =>
      p.metodo === 'GET' &&
      p.caminho === `/subscriptions/${assinatura?.external_id ?? ''}/payments`,
  );
  expect(leituras.length).toBeGreaterThanOrEqual(3);

  // A04: a equipe vê quando foi conferida e confere de novo, com a trilha.
  const equipe = await superadmin(browser, 'cob-conferencia-equipe');
  await equipe.pagina.goto(`/admin/organizacoes/${orgId}`);
  const cobranca = equipe.pagina.getByRole('region', { name: /Cobrança/ });
  await expect(cobranca.getByText('Conferida direto na Asaas em', { exact: false })).toBeVisible();
  await cobranca.getByRole('button', { name: 'Conferir na Asaas' }).click();
  await expect(
    equipe.pagina.getByText('Conferido com a Asaas. As faturas abaixo já estão atualizadas.'),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const { data } = await bancoDeTeste()
        .from('audit_logs')
        .select('actor_id')
        .eq('org_id', orgId)
        .eq('entity', 'invoices')
        .eq('action', 'update');
      return (data ?? []).map((linha) => linha.actor_id);
    })
    .toContain(equipe.id);
});

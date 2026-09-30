/**
 * C17 e A14 — o chamado de ponta a ponta: o lojista abre pela Ajuda, a equipe
 * vê na fila e responde, o lojista lê a resposta como "Equipe Storefy",
 * responde de volta e fecha. Outra empresa não enxerga nada disso.
 *
 * E C16 — os avisos por e-mail de cada pessoa: a escolha fica gravada, e quem
 * não recebe o aviso da revisão não o desliga sem querer ao salvar.
 */
import type { Browser, Page } from '@playwright/test';
import { expect, test } from './base';
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
  tornarPlatformAdmin,
} from './apoio';
import { varrer } from './axe';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);

/** A equipe interna não tem empresa própria para a limpeza achar a trilha. */
const equipeDeTeste: string[] = [];

test.afterAll(async () => {
  if (equipeDeTeste.length > 0) {
    await bancoDeTeste().from('audit_logs').delete().in('actor_id', equipeDeTeste);
  }
  await limparUsuariosDeTeste();
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

test('o lojista abre um chamado, a equipe responde, e a conversa segue até fechar', async ({
  page,
  browser,
}) => {
  const emailLojista = emailDeTeste('chamado-lojista');
  const lojistaId = await criarUsuarioConfirmado(emailLojista, 'Empresa do Chamado');
  await entrar(page, emailLojista);
  await criarLojaPelaTela(page, 'Loja do Chamado', 'loja-do-chamado.com.br');

  // Pelo menu da conta, como a pessoa acharia.
  await page.getByRole('button', { name: 'Menu da conta' }).click();
  await page.getByRole('menuitem', { name: 'Ajuda e suporte' }).click();
  await page.waitForURL('/ajuda');
  await expect(page.getByRole('heading', { name: 'Ajuda', exact: true })).toBeVisible();
  await expect(page.getByText('Nenhum chamado ainda')).toBeVisible();

  // Um guia abre e leva à tela de que fala.
  await page.getByRole('link', { name: /Primeiros passos/ }).click();
  await page.waitForURL('/ajuda/primeiros-passos');
  await expect(page.getByRole('heading', { name: 'Cadastre a loja' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cadastrar uma loja' })).toHaveAttribute(
    'href',
    '/lojas/nova',
  );

  // Uma página de chamados depois da última (link antigo) volta para a primeira, sem tela de erro.
  await page.goto('/ajuda?pagina=50');
  await expect(page).toHaveURL(/\/ajuda$/);

  // Sem preencher: um erro claro em cada campo, e nada é criado.
  await page.getByRole('button', { name: 'Abrir chamado' }).click();
  await expect(page.getByText('Escolha o assunto.')).toBeVisible();
  await expect(page.getByText('Dê um título ao chamado, com pelo menos 3 letras.')).toBeVisible();
  await expect(page.getByText('Conte um pouco mais: pelo menos 10 caracteres.')).toBeVisible();

  // O que foi escolhido e digitado continua lá depois de um erro. O sumiço do
  // erro do assunto é o sinal de que ESTE envio voltou — o da mensagem já
  // estava na tela.
  await page.getByLabel('Assunto').selectOption({ label: 'Publicação nas lojas de aplicativos' });
  await page.getByLabel('Título').fill('O app foi recusado pela Apple');
  await page.getByLabel('Mensagem').fill('curta');
  await page.getByRole('button', { name: 'Abrir chamado' }).click();
  await expect(page.getByText('Escolha o assunto.')).toHaveCount(0);
  await expect(page.getByText('Conte um pouco mais: pelo menos 10 caracteres.')).toBeVisible();
  await expect(page.getByLabel('Assunto')).toHaveValue('publicacao');
  await expect(page.getByLabel('Título')).toHaveValue('O app foi recusado pela Apple');
  await expect(page.getByLabel('Mensagem')).toHaveValue('curta');
  // A loja ativa já vem escolhida.
  await expect(page.getByLabel('Loja (opcional)')).toHaveValue(/[0-9a-f-]{36}/);

  await page
    .getByLabel('Mensagem')
    .fill('A Apple recusou dizendo que falta a política de privacidade.\nO que eu faço?');
  await page.getByRole('button', { name: 'Abrir chamado' }).click();
  await page.waitForURL(/\/ajuda\/chamados\/[0-9a-f-]{36}$/);
  const chamadoId = /chamados\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';

  await expect(page.getByRole('heading', { name: 'O app foi recusado pela Apple' })).toBeVisible();
  await expect(
    page.getByText('Publicação nas lojas de aplicativos · Loja do Chamado'),
  ).toBeVisible();
  await expect(page.getByText('Aguardando a Storefy')).toBeVisible();
  const conversa = page.getByRole('list', { name: 'Mensagens do chamado' });
  await expect(conversa.getByText('O que eu faço?')).toBeVisible();
  await varrer(page, 'C17 com o chamado aberto');

  // A equipe: o chamado aparece na visão geral e na fila de quem espera.
  const equipe = await novaPagina(browser);
  const emailEquipe = emailDeTeste('chamado-equipe');
  const equipeId = await criarUsuarioConfirmado(emailEquipe, 'Equipe do Suporte');
  equipeDeTeste.push(equipeId);
  await tornarPlatformAdmin(equipeId);
  await entrar(equipe, emailEquipe);
  await equipe.goto('/admin');
  await expect(
    equipe.getByRole('link', { name: /^Chamados esperando resposta: [1-9]\d*$/ }),
  ).toBeVisible();

  await equipe.goto('/admin/chamados');
  await expect(
    equipe.getByRole('link', { name: /^Esperando resposta \([1-9]\d*\)$/ }),
  ).toHaveAttribute('aria-current', 'page');
  await equipe.getByRole('link', { name: 'O app foi recusado pela Apple' }).click();
  await equipe.waitForURL(`/admin/chamados/${chamadoId}`);
  await expect(equipe.getByText(`aberto por ${emailLojista}`, { exact: false })).toBeVisible();
  await expect(equipe.getByRole('link', { name: 'Empresa do Chamado' })).toBeVisible();
  await varrer(equipe, 'A14 com a fila');

  // Resposta vazia não sai.
  await equipe.getByRole('button', { name: 'Responder' }).click();
  await expect(equipe.getByText('Escreva a resposta.')).toBeVisible();

  await equipe
    .getByLabel('Resposta da equipe')
    .fill('Olá! Coloque o endereço da política em Publicação › Dados da loja e envie de novo.');
  await equipe.getByRole('button', { name: 'Responder' }).click();
  await expect(equipe.getByText('Resposta enviada.')).toBeVisible();
  await expect(equipe.getByLabel('Resposta da equipe')).toHaveValue('');
  await expect(equipe.getByText('Aguardando o cliente')).toBeVisible();
  await varrer(equipe, 'A14 com a conversa respondida');

  // O lojista lê a resposta como da equipe, sem o e-mail de quem atendeu.
  await page.reload();
  await expect(page.getByText('Respondido', { exact: true })).toBeVisible();
  await expect(conversa.getByText('Equipe Storefy')).toBeVisible();
  await expect(conversa.getByText(/Publicação › Dados da loja/)).toBeVisible();
  await expect(page.getByText(emailEquipe)).toHaveCount(0);

  // Responde de volta: o chamado volta para a vez da equipe.
  await page.getByLabel('Sua resposta').fill('Pronto, coloquei. Obrigado!');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('Mensagem enviada.')).toBeVisible();
  await expect(page.getByText('Aguardando a Storefy')).toBeVisible();
  await varrer(page, 'C17 com a resposta da equipe');

  // Fechar pede confirmação; "Voltar" não fecha.
  await page.getByRole('button', { name: 'Fechar chamado' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('o chamado reabre');
  await page.getByRole('button', { name: 'Voltar' }).click();
  await expect(page.getByText('Aguardando a Storefy')).toBeVisible();

  await page.getByRole('button', { name: 'Fechar chamado' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Fechar chamado' }).click();
  await expect(page.getByText('Fechado', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Escrever de novo (reabre o chamado)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fechar chamado' })).toHaveCount(0);

  // A lista da Ajuda mostra o chamado com a situação.
  await page.goto('/ajuda');
  await expect(
    page.getByRole('link', { name: /O app foi recusado pela Apple.*Fechado/ }),
  ).toBeVisible();

  // A equipe vê o fechado no recorte certo, e pode reabrir.
  await equipe.goto('/admin/chamados?situacao=fechado');
  await expect(equipe.getByRole('link', { name: 'O app foi recusado pela Apple' })).toBeVisible();

  // A trilha da empresa registra a abertura e cada mudança de situação.
  const { data: trilha } = await bancoDeTeste()
    .from('audit_logs')
    .select('action, actor_id')
    .eq('entity', 'support_tickets')
    .eq('entity_id', chamadoId)
    .order('created_at');
  expect(trilha?.map((linha) => linha.action)).toEqual(['create', 'update', 'update', 'update']);
  expect(trilha?.[0]?.actor_id).toBe(lojistaId);
  expect(trilha?.[1]?.actor_id).toBe(equipeId);

  // Outra empresa não abre o chamado nem pela URL.
  const emailOutra = emailDeTeste('chamado-outra');
  await criarUsuarioConfirmado(emailOutra, 'Outra Empresa');
  const outra = await novaPagina(browser);
  await entrar(outra, emailOutra);
  await outra.goto(`/ajuda/chamados/${chamadoId}`);
  await expect(outra.getByText('Página não encontrada')).toBeVisible();
  await expect(outra.getByText('O app foi recusado pela Apple')).toHaveCount(0);
  await outra.goto('/ajuda');
  await expect(outra.getByText('Nenhum chamado ainda')).toBeVisible();

  // E o lojista não entra na fila da equipe.
  await page.goto('/admin/chamados');
  await expect(page).toHaveURL(/\/admin\/sem-acesso/);

  expect(await orgDe(lojistaId)).not.toBe('');
});

test('cada pessoa escolhe os próprios avisos, e o membro não desliga a revisão sem querer', async ({
  page,
  browser,
}) => {
  const emailDono = emailDeTeste('avisos-dono');
  const donoId = await criarUsuarioConfirmado(emailDono, 'Empresa dos Avisos');
  await entrar(page, emailDono);
  const orgId = await orgDe(donoId);

  await page.goto('/configuracoes');
  const revisao = page.getByRole('checkbox', { name: /Resultado da revisão do app/ });
  const suporte = page.getByRole('checkbox', { name: /Resposta do suporte/ });
  // Sem escolha gravada, recebe tudo.
  await expect(revisao).toBeChecked();
  await expect(suporte).toBeChecked();
  await expect(revisao).toBeEnabled();

  await revisao.uncheck();
  await page.getByRole('button', { name: 'Salvar avisos' }).click();
  await expect(page.getByText('Avisos salvos.')).toBeVisible();
  // A caixa não volta atrás depois de salvar, nem depois de recarregar.
  await expect(revisao).not.toBeChecked();
  await page.reload();
  await expect(revisao).not.toBeChecked();
  await expect(suporte).toBeChecked();

  // Um membro entra pelo convite.
  await page.goto('/configuracoes/equipe');
  await page.waitForLoadState('networkidle');
  const emailMembro = emailDeTeste('avisos-membro');
  await page.getByLabel('E-mail da pessoa').fill(emailMembro);
  await page.getByLabel('Papel', { exact: true }).selectOption({ label: 'Membro' });
  await page.getByRole('button', { name: 'Convidar', exact: true }).click();
  const link = (await page.locator('pre[data-texto]').first().textContent())?.trim() ?? '';
  const membro = await novaPagina(browser);
  await membro.goto(link);
  await membro.getByLabel('Seu nome').fill('Membro dos Avisos');
  await membro.getByLabel('Crie uma senha').fill(SENHA_PADRAO);
  await membro.getByRole('button', { name: 'Criar conta e aceitar' }).click();
  await membro.waitForURL('/');

  // O membro não recebe o aviso da revisão: a caixa aparece travada.
  await membro.goto('/configuracoes');
  const revisaoDoMembro = membro.getByRole('checkbox', { name: /Resultado da revisão do app/ });
  await expect(revisaoDoMembro).toBeDisabled();
  await expect(
    membro.getByText('Só proprietários e administradores recebem este aviso.'),
  ).toBeVisible();

  await membro.getByRole('checkbox', { name: /Resposta do suporte/ }).uncheck();
  await membro.getByRole('button', { name: 'Salvar avisos' }).click();
  await expect(membro.getByText('Avisos salvos.')).toBeVisible();
  await expect(revisaoDoMembro).toBeChecked();

  // No banco: cada um só com a própria escolha, e a revisão do membro intacta.
  const { data: escolhas } = await bancoDeTeste()
    .from('email_preferences')
    .select('user_id, revisao_do_app, resposta_do_suporte')
    .eq('org_id', orgId);
  const doDono = escolhas?.find((linha) => linha.user_id === donoId);
  const doMembro = escolhas?.find((linha) => linha.user_id !== donoId);
  expect(escolhas).toHaveLength(2);
  expect(doDono).toMatchObject({ revisao_do_app: false, resposta_do_suporte: true });
  expect(doMembro).toMatchObject({ revisao_do_app: true, resposta_do_suporte: false });

  // A escolha do dono não mudou com a do membro.
  await page.goto('/configuracoes');
  await expect(revisao).not.toBeChecked();
  await expect(suporte).toBeChecked();
});

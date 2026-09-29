/**
 * A identidade do app (C12 e C06a): o identificador que a Storefy preenche, a
 * trava depois que o app chega a uma loja de aplicativos, e o nome do app.
 *
 * O passo "Já criei o app" fala com a API da Apple de verdade, com a chave do
 * lojista: ele tem teste de unidade contra uma App Store Connect falsa
 * (`lib/apple.test.ts`), e aqui entra o resto do caminho, que é todo nosso.
 */
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

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

async function appDaLoja(lojaId: string) {
  const { data, error } = await bancoDeTeste()
    .from('apps')
    .select('id, display_name, bundle_id_ios, package_android')
    .eq('store_id', lojaId)
    .single();
  if (error != null) throw new Error(error.message);
  return data;
}

/** Um pedaço único por execução: o identificador é único entre todos os apps. */
function unico(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
}

test('o identificador vem sugerido, confere o formato, grava e trava depois do envio', async ({
  page,
}) => {
  const marca = unico();
  const email = emailDeTeste('identificador');
  const donoId = await criarUsuarioConfirmado(email, 'Empresa Identificador');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Identificador', `ident${marca}.com.br`);
  const esperado = `br.com.ident${marca}.app`;

  await page.goto('/publicacao');
  const cartao = page.getByRole('region', { name: 'Identificador do app' });
  const campo = cartao.getByLabel('Identificador');
  // Preenchido pela Storefy, a partir do endereço da loja.
  await expect(campo).toHaveValue(esperado);

  // Hífen o Google recusa: o motivo aparece, e o que foi digitado fica.
  await campo.fill('br.com.minha-loja.app');
  await cartao.getByRole('button', { name: 'Usar este identificador' }).click();
  await expect(cartao.getByRole('alert')).toContainText('Use só letras minúsculas e números');
  await expect(campo).toHaveValue('br.com.minha-loja.app');

  await campo.fill(esperado);
  await cartao.getByRole('button', { name: 'Usar este identificador' }).click();
  await expect(page.getByText('Identificador salvo.')).toBeVisible();
  expect(await appDaLoja(lojaId)).toMatchObject({
    bundle_id_ios: esperado,
    package_android: esperado,
  });

  // O passo da Apple pede a conta conectada primeiro, com o caminho.
  await expect(cartao.getByRole('link', { name: 'Conectar a conta Apple' })).toHaveAttribute(
    'href',
    '/publicacao/contas',
  );

  // No checklist: o identificador pronto nas duas lojas; o app na Apple ainda
  // falta, e o "Resolver" leva ao cartão.
  const itensDoIdentificador = page
    .getByRole('listitem')
    .filter({ hasText: 'Identificador do app' });
  await expect(itensDoIdentificador).toHaveCount(2);
  for (const item of await itensDoIdentificador.all()) await expect(item).toContainText('Pronto:');
  const itemDaApple = page
    .getByRole('listitem')
    .filter({ hasText: 'App criado no App Store Connect' });
  await expect(itemDaApple).toContainText('Falta:');
  await expect(itemDaApple.getByRole('link', { name: 'Resolver' })).toHaveAttribute(
    'href',
    '/publicacao#identificador',
  );

  // Antes de o app chegar a uma loja, o identificador ainda troca.
  await cartao.getByRole('button', { name: 'Trocar o identificador' }).click();
  await campo.fill(`${esperado}2`);
  await cartao.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Identificador salvo.')).toBeVisible();
  await expect.poll(async () => (await appDaLoja(lojaId)).bundle_id_ios).toBe(`${esperado}2`);

  // O binário gerado para o iPhone trava: a tela não oferece mais a troca, e
  // o banco recusa quem tentar por fora.
  const app = await appDaLoja(lojaId);
  const { error: erroDoBuild } = await bancoDeTeste()
    .from('builds')
    .insert({ app_id: app.id, platform: 'ios', profile: 'production', status: 'finished' });
  if (erroDoBuild != null) throw new Error(erroDoBuild.message);
  await page.reload();
  await expect(
    cartao.getByText('O app já chegou a uma loja de aplicativos com este identificador', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(cartao.getByRole('button', { name: 'Trocar o identificador' })).toHaveCount(0);
  const { error } = await bancoDeTeste().rpc('definir_identificador_do_app', {
    p_app_id: app.id,
    p_ator: donoId,
    p_identificador: 'br.com.outro.app',
  });
  expect(error?.message).toContain('não pode mais mudar');
});

test('identificador de outro app não se repete: a sugestão pula para o próximo livre', async ({
  page,
}) => {
  const marca = unico();
  const ocupado = `br.com.dup${marca}.app`;

  // Outra empresa já tem o identificador que esta loja receberia.
  const outro = emailDeTeste('identificador-outro');
  const outroId = await criarUsuarioConfirmado(outro, 'Empresa Que Chegou Antes');
  await entrar(page, outro);
  const lojaDaOutra = await criarLojaPelaTela(page, 'Loja Antes', `antes${marca}.com.br`);
  const { error } = await bancoDeTeste().rpc('definir_identificador_do_app', {
    p_app_id: (await appDaLoja(lojaDaOutra)).id,
    p_ator: outroId,
    p_identificador: ocupado,
  });
  if (error != null) throw new Error(error.message);

  await page.context().clearCookies();
  const email = emailDeTeste('identificador-depois');
  await criarUsuarioConfirmado(email, 'Empresa Que Chegou Depois');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Depois', `dup${marca}.com.br`);

  await page.goto('/publicacao');
  const cartao = page.getByRole('region', { name: 'Identificador do app' });
  const campo = cartao.getByLabel('Identificador');
  await expect(campo).toHaveValue(`${ocupado}2`);

  // Insistir no ocupado dá o motivo, sem gravar nada.
  await campo.fill(ocupado);
  await cartao.getByRole('button', { name: 'Usar este identificador' }).click();
  await expect(cartao.getByRole('alert')).toHaveText(
    'Esse identificador já é de outro app da Storefy. Escolha outro.',
  );
  expect((await appDaLoja(lojaId)).bundle_id_ios).toBeNull();
});

test('quem é membro vê a sugestão, mas não confirma nem troca o identificador', async ({
  page,
}) => {
  const marca = unico();
  const dono = emailDeTeste('identificador-dono');
  await criarUsuarioConfirmado(dono, 'Empresa Identificador Membro');
  await entrar(page, dono);
  const lojaId = await criarLojaPelaTela(page, 'Loja do Membro', `membro${marca}.com.br`);

  const membro = emailDeTeste('identificador-membro');
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
  await page.goto('/publicacao');
  const cartao = page.getByRole('region', { name: 'Identificador do app' });
  await expect(cartao.getByText(`br.com.membro${marca}.app`)).toBeVisible();
  await expect(
    cartao.getByText('Um proprietário ou administrador confirma o identificador.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(cartao.getByLabel('Identificador')).toHaveCount(0);
  await expect(cartao.getByRole('button')).toHaveCount(0);
});

test('o nome do app muda no editor, com o limite da App Store', async ({ page }) => {
  const email = emailDeTeste('nome-do-app');
  await criarUsuarioConfirmado(email, 'Empresa Nome do App');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja do Nome', 'loja-do-nome.com.br');

  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  const nome = page.getByLabel('Nome do app');
  await expect(nome).toHaveValue('Loja do Nome');

  // Acima de 30 caracteres a App Store cortaria: recusado, com o texto no campo.
  const comprido = 'Um nome comprido demais para a loja';
  await nome.fill(comprido);
  await page.getByRole('button', { name: 'Salvar nome' }).click();
  await expect(page.getByText('O nome passa de 30 caracteres', { exact: false })).toBeVisible();
  await expect(nome).toHaveValue(comprido);
  expect((await appDaLoja(lojaId)).display_name).toBe('Loja do Nome');

  // Um nome que cabe na loja, mas não inteiro embaixo do ícone: grava e avisa.
  await nome.fill('Oak Vintage Store');
  await expect(page.getByText(/o iPhone mostra uns 12 caracteres/)).toBeVisible();
  await page.getByRole('button', { name: 'Salvar nome' }).click();
  await expect(page.getByText('Nome do app salvo.', { exact: false })).toBeVisible();
  await expect.poll(async () => (await appDaLoja(lojaId)).display_name).toBe('Oak Vintage Store');

  // A Publicação passa a usar o nome novo no checklist.
  await page.goto('/publicacao');
  const itemDoNome = page.getByRole('listitem').filter({ hasText: 'Nome do app definido' });
  for (const item of await itemDoNome.all()) await expect(item).toContainText('Pronto:');
});

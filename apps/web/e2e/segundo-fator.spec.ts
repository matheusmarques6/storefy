/**
 * A01 — a equipe da plataforma entra com a senha E com o app autenticador.
 *
 * Quem é da equipe enxerga todos os clientes: uma senha vazada não pode virar
 * esse acesso. No primeiro acesso a pessoa cadastra o app (QR code ou chave);
 * nos seguintes, digita o código. O banco confere o mesmo — a sessão só da
 * senha, chamando a API direto, não lê nada de cliente nenhum. E quem perde o
 * celular é destravado por um superadmin, na A11.
 */
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import type { Database } from '@storefy/db';
import {
  MOTIVO_PULO,
  SENHA_PADRAO,
  SUPABASE_DISPONIVEL,
  ativarAppPelaTela,
  bancoDeTeste,
  criarUsuarioConfirmado,
  digitarCodigoDoApp,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
  segredoDoAppDeTeste,
  tornarPlatformAdmin,
} from './apoio';
import { codigoTotp } from './totp';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

/** Um código que o app NÃO mostraria agora: o certo com o primeiro dígito trocado. */
function codigoErrado(segredo: string): string {
  const certo = codigoTotp(segredo);
  return `${String((Number(certo[0]) + 5) % 10)}${certo.slice(1)}`;
}

test('no primeiro acesso a equipe cadastra o app; nos seguintes, digita o código', async ({
  page,
}) => {
  const email = emailDeTeste('2fa-novo');
  const id = await criarUsuarioConfirmado(email, 'Equipe 2FA');
  // Da equipe, e ainda sem app nenhum — como sai do bootstrap ou de um convite.
  const { error } = await bancoDeTeste()
    .from('platform_admins')
    .insert({ user_id: id, role: 'support' });
  if (error != null) throw new Error(error.message);

  await page.goto('/admin/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA_PADRAO);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL('**/admin/ativar-2fa');
  await expect(
    page.getByRole('heading', { name: 'Ative a verificação em duas etapas' }),
  ).toBeVisible();

  // A senha certa não abre tela nenhuma do painel: todas levam ao cadastro.
  await page.goto('/admin/organizacoes');
  await page.waitForURL('**/admin/ativar-2fa');
  await page.goto('/admin/verificar');
  await page.waitForURL('**/admin/ativar-2fa');

  // Começa: o QR code e a chave para digitar aparecem.
  await page.getByRole('button', { name: 'Começar' }).click();
  await expect(
    page.getByRole('img', { name: 'QR code para cadastrar a Storefy Admin no app autenticador' }),
  ).toBeVisible();
  const chave = await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/).innerText();
  const segredo = chave.replace(/\s/g, '');

  // Campo vazio e código errado são recusados, com o motivo embaixo do campo.
  const campo = page.getByLabel('Código que o app mostra');
  await page.getByRole('button', { name: 'Ativar e entrar' }).click();
  await expect(page.getByText('Digite os 6 números que aparecem no app.')).toBeVisible();
  await campo.fill(codigoErrado(segredo));
  await page.getByRole('button', { name: 'Ativar e entrar' }).click();
  await expect(page.getByText(/^Código incorreto\./)).toBeVisible();
  await expect(campo).toHaveValue(codigoErrado(segredo));

  // "Gerar outro QR code" troca a chave: a antiga deixa de valer.
  await page.getByRole('button', { name: 'Gerar outro QR code' }).click();
  await expect(page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/)).not.toHaveText(chave);
  const novaChave = await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/).innerText();
  const novoSegredo = novaChave.replace(/\s/g, '');
  await page.getByLabel('Código que o app mostra').fill(codigoTotp(novoSegredo));
  await page.getByRole('button', { name: 'Ativar e entrar' }).click();
  await page.waitForURL((url) => url.pathname === '/admin');
  await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible();

  // Um app só: o cadastro abandonado saiu, e a ativação ficou na trilha.
  const { data: usuario } = await bancoDeTeste().auth.admin.getUserById(id);
  expect(usuario.user?.factors?.map((fator) => fator.status)).toEqual(['verified']);
  const { data: trilha } = await bancoDeTeste()
    .from('audit_logs')
    .select('actor_id, diff')
    .eq('entity', 'platform_admins')
    .eq('entity_id', id)
    .is('org_id', null);
  expect(trilha).toEqual([{ actor_id: id, diff: { segundo_fator: 'ativado' } }]);

  // Sair leva ao login do admin; de volta, a senha pede o código.
  await page.getByRole('button', { name: 'Sair' }).click();
  await page.waitForURL('**/admin/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA_PADRAO);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL('**/admin/verificar');
  await page.goto('/admin/ativar-2fa');
  await page.waitForURL('**/admin/verificar');

  const codigo = page.getByLabel('Código do app');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Digite os 6 números que aparecem no app.')).toBeVisible();
  await codigo.fill(codigoErrado(novoSegredo));
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText(/^Código incorreto\./)).toBeVisible();
  await digitarCodigoDoApp(page, novoSegredo);
  await page.waitForURL((url) => url.pathname === '/admin');
  await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
});

test('só com a senha, a API do Supabase não abre os dados dos clientes', async () => {
  // Um cliente com loja, para haver o que vazar.
  const emailCliente = emailDeTeste('2fa-cliente');
  await criarUsuarioConfirmado(emailCliente, 'Cliente 2FA');

  const email = emailDeTeste('2fa-api');
  const id = await criarUsuarioConfirmado(email, 'Equipe 2FA API');
  await tornarPlatformAdmin(id);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const sessao = createClient<Database>(url, anonima, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: erroDoLogin } = await sessao.auth.signInWithPassword({
    email,
    password: SENHA_PADRAO,
  });
  expect(erroDoLogin).toBeNull();

  // A mesma chave anônima do navegador, com a sessão de quem só tem a senha.
  const { data: soDaSenha } = await sessao.from('organizations').select('id');
  expect(soDaSenha).toHaveLength(1);
  const { error: resumoRecusado } = await sessao.rpc('resumo_do_admin');
  expect(resumoRecusado).not.toBeNull();
  const { error: equipeRecusada } = await sessao.rpc('admin_equipe');
  expect(equipeRecusada).not.toBeNull();

  // Com o código do app, a mesma pessoa volta a ser equipe.
  const { data: fatores } = await sessao.auth.mfa.listFactors();
  const app = fatores?.totp[0];
  if (app === undefined) throw new Error('O admin de teste ficou sem o app autenticador.');
  const { data: fator } = await bancoDeTeste().auth.admin.mfa.listFactors({ userId: id });
  expect(fator?.factors).toHaveLength(1);
  // O segredo não sai do Auth; o apoio guardou o de quando cadastrou o app.
  const segredo = segredoDoAppDeTeste(email);
  const { error: erroDoCodigo } = await sessao.auth.mfa.challengeAndVerify({
    factorId: app.id,
    code: codigoTotp(segredo),
  });
  expect(erroDoCodigo).toBeNull();
  const { data: comOApp } = await sessao.from('organizations').select('id');
  expect((comOApp ?? []).length).toBeGreaterThan(1);
  const { error: resumoLiberado } = await sessao.rpc('resumo_do_admin');
  expect(resumoLiberado).toBeNull();
});

test('quem perde o celular é destravado por um superadmin; o suporte não redefine', async ({
  page,
  browser,
}) => {
  const emailChefe = emailDeTeste('2fa-chefe');
  await tornarPlatformAdmin(await criarUsuarioConfirmado(emailChefe, 'Equipe 2FA Chefe'));
  const emailSuporte = emailDeTeste('2fa-suporte');
  const idSuporte = await criarUsuarioConfirmado(emailSuporte, 'Equipe 2FA Suporte');
  await tornarPlatformAdmin(idSuporte, 'support');

  // O suporte está com o painel aberto no próprio navegador.
  const contextoDoSuporte = await browser.newContext();
  const suporte = await contextoDoSuporte.newPage();
  await entrar(suporte, emailSuporte);
  await suporte.goto('/admin/equipe');
  await suporte.waitForLoadState('networkidle');
  // Suporte vê quem tem a verificação, mas não redefine a de ninguém.
  await expect(suporte.getByRole('button', { name: 'Redefinir verificação' })).toHaveCount(0);

  await entrar(page, emailChefe);
  await page.goto('/admin/equipe');
  await page.waitForLoadState('networkidle');
  const linha = page.getByRole('row').filter({ hasText: emailSuporte });
  await expect(linha.getByText('Ativa', { exact: true })).toBeVisible();
  // Na própria linha não há o que redefinir.
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: emailChefe })
      .getByRole('button', { name: 'Redefinir verificação' }),
  ).toHaveCount(0);

  await linha.getByRole('button', { name: 'Redefinir verificação' }).click();
  const dialogo = page.getByRole('alertdialog');
  await expect(dialogo.getByText('sai de todas as sessões abertas')).toBeVisible();
  await dialogo.getByRole('button', { name: 'Redefinir' }).click();
  await expect(page.getByText(/^Verificação redefinida\./)).toBeVisible();
  await expect(linha.getByText('Falta ativar')).toBeVisible();
  await expect(linha.getByRole('button', { name: 'Redefinir verificação' })).toHaveCount(0);

  // O navegador do suporte perdeu a sessão na hora, e não quando o token vencer —
  // e o login diz por que ela está ali.
  await suporte.goto('/admin/equipe');
  await suporte.waitForURL('**/admin/entrar?aviso=sessao-encerrada');
  await expect(suporte.getByText(/Sua sessão terminou/)).toBeVisible();

  // Entrando de novo, a senha leva ao cadastro de um app novo.
  await suporte.getByLabel('E-mail').fill(emailSuporte);
  await suporte.getByLabel('Senha').fill(SENHA_PADRAO);
  await suporte.getByRole('button', { name: 'Entrar', exact: true }).click();
  await suporte.waitForURL('**/admin/ativar-2fa');
  await ativarAppPelaTela(suporte);
  await suporte.waitForURL((url) => url.pathname === '/admin');
  await contextoDoSuporte.close();

  // A redefinição ficou na trilha, com quem fez.
  const { data: trilha } = await bancoDeTeste()
    .from('audit_logs')
    .select('diff')
    .eq('entity', 'platform_admins')
    .eq('entity_id', idSuporte)
    .is('org_id', null);
  const redefinicoes = (trilha ?? []).filter(
    (linhaDaTrilha) =>
      (linhaDaTrilha.diff as { segundo_fator?: string } | null)?.segundo_fator === 'redefinido',
  );
  expect(redefinicoes).toHaveLength(1);
});

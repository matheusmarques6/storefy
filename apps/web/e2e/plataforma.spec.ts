/**
 * O que a Storefy liga para todos (A13), a atualização obrigatória (C06d) e o
 * app de cada loja na ficha do cliente (A04).
 *
 * As chaves da plataforma valem para TODOS os lojistas: o que estava gravado
 * antes da suíte volta no fim, mesmo se um teste falhar no meio.
 */
import { expect, test, type Page } from '@playwright/test';
import type { Json } from '@storefy/db';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  SENHA_PADRAO,
  bancoDeTeste,
  criarLojaPelaTela,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
  tornarPlatformAdmin,
} from './apoio';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);

let chavesDeAntes: { chave: string; valor: Json }[] = [];
/** A trilha da plataforma não tem organização: sai por quem a gerou. */
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
    await banco
      .from('audit_logs')
      .delete()
      .eq('entity', 'platform_settings')
      .in('actor_id', equipeDeTeste);
  }
  await limparUsuariosDeTeste();
});

async function entrarComoEquipe(
  page: Page,
  rotulo: string,
  papel: 'superadmin' | 'support' = 'superadmin',
): Promise<string> {
  const email = emailDeTeste(rotulo);
  const id = await criarUsuarioConfirmado(email, `Equipe ${rotulo}`);
  await tornarPlatformAdmin(id, papel);
  equipeDeTeste.push(id);
  await entrar(page, email);
  return id;
}

test('fechar o cadastro e avisar todos os lojistas, pela A13, com auditoria', async ({
  page,
  browser,
}) => {
  const adminId = await entrarComoEquipe(page, 'chaves');

  // Alguém está no meio do cadastro quando a equipe fecha.
  const visitante = await (await browser.newContext()).newPage();
  await visitante.goto('/cadastrar');
  await visitante.waitForLoadState('networkidle');
  await visitante.getByLabel('Nome da sua empresa').fill('Empresa Atrasada');
  await visitante.getByLabel('E-mail').fill(emailDeTeste('atrasada'));
  await visitante.getByLabel('Senha').fill(SENHA_PADRAO);

  await page.goto('/admin/sistema');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Cadastro aberto').uncheck();
  await page
    .getByLabel('Aviso no painel de todos os lojistas')
    .fill('Manutenção programada hoje às 23h. O app dos seus clientes não para.');
  // A prévia mostra a faixa antes de salvar.
  await expect(page.getByLabel('Prévia do aviso')).toContainText('Manutenção programada');
  await page.getByRole('button', { name: 'Salvar chaves' }).click();
  await expect(page.getByText('Chaves salvas.')).toBeVisible();
  // A tela continua dizendo o que foi gravado: o React limpa o formulário no
  // fim da ação, e a caixa voltava a aparecer marcada com o cadastro fechado.
  await expect(page.getByLabel('Cadastro aberto')).not.toBeChecked();
  await expect(page.getByLabel('Aviso no painel de todos os lojistas')).toHaveValue(
    'Manutenção programada hoje às 23h. O app dos seus clientes não para.',
  );

  // O formulário que já estava aberto não cria conta: o servidor confere de novo.
  await visitante.getByRole('button', { name: 'Criar conta' }).click();
  await expect(
    visitante.getByRole('alert').filter({ hasText: 'Os cadastros estão fechados por enquanto.' }),
  ).toBeVisible();
  await expect(visitante).toHaveURL(/\/cadastrar/);

  // E quem chega agora vê o cadastro fechado, sem formulário.
  await visitante.goto('/cadastrar');
  await expect(visitante.getByText('Cadastros fechados por enquanto')).toBeVisible();
  await expect(visitante.getByLabel('Nome da sua empresa')).toHaveCount(0);

  // Todo lojista vê o aviso no topo do painel.
  const lojista = await (await browser.newContext()).newPage();
  const emailLojista = emailDeTeste('chaves-lojista');
  await criarUsuarioConfirmado(emailLojista, 'Empresa Avisada');
  await entrar(lojista, emailLojista);
  await expect(
    lojista.getByRole('status').filter({ hasText: 'Manutenção programada hoje às 23h' }),
  ).toBeVisible();

  // A trilha diz quem mudou o quê, com o antes e o depois.
  const { data: trilha } = await bancoDeTeste()
    .from('audit_logs')
    .select('org_id, diff')
    .eq('entity', 'platform_settings')
    .eq('actor_id', adminId);
  expect(trilha).toHaveLength(2);
  expect(JSON.stringify(trilha)).toContain('"cadastro_aberto":{"de":true,"para":false}');
  expect(JSON.stringify(trilha)).toContain('Manutenção programada hoje às 23h');

  // Reabrir e apagar o aviso volta tudo ao normal. (O toast anterior sai
  // antes, para o "Chaves salvas." de baixo ser o desta gravação.)
  await expect(page.getByText('Chaves salvas.')).toHaveCount(0);
  await page.getByLabel('Cadastro aberto').check();
  await page.getByLabel('Aviso no painel de todos os lojistas').fill('');
  await expect(page.getByLabel('Prévia do aviso')).toHaveCount(0);
  await page.getByRole('button', { name: 'Salvar chaves' }).click();
  await expect(page.getByText('Chaves salvas.')).toBeVisible();
  await expect(page.getByLabel('Cadastro aberto')).toBeChecked();

  await visitante.goto('/cadastrar');
  await expect(visitante.getByLabel('Nome da sua empresa')).toBeVisible();
  await lojista.reload();
  await expect(lojista.getByRole('heading', { name: 'Olá, Empresa Avisada' })).toBeVisible();
  await expect(lojista.getByText('Manutenção programada')).toHaveCount(0);

  // Salvar sem mudar nada não grava trilha.
  await page.getByRole('button', { name: 'Salvar chaves' }).click();
  await expect(page.getByText('Nada mudou.')).toBeVisible();
  const { count } = await bancoDeTeste()
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('entity', 'platform_settings')
    .eq('actor_id', adminId);
  expect(count).toBe(4);
});

test('suporte vê as chaves, mas não muda', async ({ page }) => {
  await entrarComoEquipe(page, 'chaves-suporte', 'support');

  await page.goto('/admin/sistema');
  await expect(page.getByText('Só superadmin muda estas chaves.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar chaves' })).toHaveCount(0);
  await expect(page.getByLabel('Cadastro aberto')).toBeDisabled();
  await expect(page.getByLabel('Aviso no painel de todos os lojistas')).toBeDisabled();
});

test('atualização obrigatória: só a versão aprovada nas duas lojas, e ela chega à config no ar e à ficha do cliente', async ({
  page,
  browser,
}) => {
  const email = emailDeTeste('atualizacao');
  const lojistaId = await criarUsuarioConfirmado(email, 'Empresa Atualiza');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Atualiza', 'loja-atualiza.com.br');

  // Sem nada aprovado, não há o que exigir — e a tela diz isso.
  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Recursos' }).click();
  await expect(
    page.getByText('O app ainda não tem uma versão aprovada nas lojas de aplicativos.'),
  ).toBeVisible();
  await expect(page.getByRole('radio', { name: /Exigir a versão/ })).toHaveCount(0);

  /*
   * O veredito das lojas de aplicativos: iPhone aprovado no 12, Android no 9.
   * Aprovação vem da Apple e do Google, e não de uma tela do painel — por
   * isso o teste grava direto o que o workflow gravaria ao receber o aviso.
   * O contador é do app, e o 12 não existe no Android: dá para exigir o 9.
   */
  const banco = bancoDeTeste();
  const { data: app } = await banco.from('apps').select('id').eq('store_id', lojaId).single();
  if (app == null) throw new Error('A loja de teste ficou sem app.');
  const { error } = await banco.from('builds').insert([
    { app_id: app.id, platform: 'ios', status: 'approved', version: '1.0.12', build_number: 12 },
    { app_id: app.id, platform: 'android', status: 'approved', version: '1.0.9', build_number: 9 },
  ]);
  expect(error).toBeNull();

  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Recursos' }).click();
  await expect(page.getByRole('radio', { name: /1\.0\.12/ })).toHaveCount(0);
  await page.getByRole('radio', { name: /Exigir a versão 1\.0\.9/ }).check();
  // O rascunho se salva sozinho, um instante depois da última mudança.
  await expect(page.getByText(/Rascunho salvo às/)).toBeVisible();
  await page.getByRole('button', { name: /Publicar alterações/ }).click();
  await page.getByRole('button', { name: 'Publicar agora' }).click();
  await expect(page.getByText(/Versão \d+ publicada/)).toBeVisible();

  const { data: publicada } = await banco
    .from('app_configs')
    .select('config')
    .eq('app_id', app.id)
    .eq('status', 'published')
    .single();
  expect((publicada?.config as { minSupportedBuild?: number } | null)?.minSupportedBuild).toBe(9);

  // A equipe vê na ficha do cliente o que está exigido e o que cada loja aprovou.
  const { data: vinculo } = await banco
    .from('memberships')
    .select('org_id')
    .eq('user_id', lojistaId)
    .single();
  if (vinculo == null) throw new Error('O lojista de teste ficou sem organização.');

  const equipe = await (await browser.newContext()).newPage();
  await entrarComoEquipe(equipe, 'atualizacao-equipe');
  await equipe.goto(`/admin/organizacoes/${vinculo.org_id}`);
  const bloco = equipe.getByRole('region', { name: 'App e push' });
  await expect(bloco.getByText('Exige 1.0.9')).toBeVisible();
  await expect(bloco.getByText('1.0.12', { exact: true })).toBeVisible();
  await expect(bloco.getByText('1.0.9', { exact: true })).toBeVisible();
  // A config no ar, com a data — e não o rascunho que o editor abriu depois.
  await expect(bloco.getByText(/^Versão \d+, \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
});

test('a ficha de um cliente que ainda não publicou diz isso, sem inventar número', async ({
  browser,
  page,
}) => {
  const cliente = await (await browser.newContext()).newPage();
  const emailCliente = emailDeTeste('ficha-app');
  const clienteId = await criarUsuarioConfirmado(emailCliente, 'Empresa Ficha');
  await entrar(cliente, emailCliente);
  await criarLojaPelaTela(cliente, 'Loja da Ficha', 'loja-da-ficha.com.br');

  const { data: vinculo } = await bancoDeTeste()
    .from('memberships')
    .select('org_id')
    .eq('user_id', clienteId)
    .single();
  if (vinculo == null) throw new Error('O cliente de teste ficou sem organização.');

  await entrarComoEquipe(page, 'ficha-equipe');
  await page.goto(`/admin/organizacoes/${vinculo.org_id}`);

  const bloco = page.getByRole('region', { name: 'App e push' });
  await expect(bloco.getByRole('heading', { name: /Loja da Ficha/ })).toBeVisible();
  await expect(bloco.getByText('Nunca publicada')).toBeVisible();
  await expect(bloco.getByText('Não exige')).toBeVisible();
  await expect(bloco.getByText('Nada aprovado ainda')).toHaveCount(2);
  await expect(bloco.getByText('Não configuradas')).toBeVisible();
  await expect(bloco.getByText('Nenhuma automação ligada.')).toBeVisible();
});

test('C13: o vídeo do passo a passo, gravado na A13, aparece no cartão da conta ainda não conectada', async ({
  browser,
}) => {
  const equipe = await (await browser.newContext()).newPage();
  const idDaEquipe = await entrarComoEquipe(equipe, 'c13-equipe');
  await equipe.goto('/admin/sistema');
  await equipe.waitForLoadState('networkidle');
  const videoDaApple = equipe.getByLabel('Vídeo: conectar a conta Apple');
  const salvar = equipe.getByRole('button', { name: 'Salvar chaves' });

  // O que não é vídeo desses serviços é recusado, dizendo o que aceita.
  await videoDaApple.fill('https://exemplo.com/video.mp4');
  await salvar.click();
  await expect(equipe.locator('form').getByRole('alert')).toContainText(
    'O vídeo da Apple precisa ser um link do YouTube, do Vimeo ou do Loom',
  );

  await videoDaApple.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await equipe.getByLabel('Vídeo: conectar a conta Google').fill('https://vimeo.com/123456789');
  await salvar.click();
  await expect(equipe.getByText('Chaves salvas.')).toBeVisible();

  const { data: trilha } = await bancoDeTeste()
    .from('audit_logs')
    .select('diff')
    .eq('entity', 'platform_settings')
    .eq('actor_id', idDaEquipe);
  expect(JSON.stringify(trilha)).toContain('video_da_apple');
  expect(JSON.stringify(trilha)).toContain('video_do_google');

  // O lojista vê os dois vídeos, pelo player — o do YouTube sem cookies.
  const lojista = await (await browser.newContext()).newPage();
  const email = emailDeTeste('c13-lojista');
  await criarUsuarioConfirmado(email, 'Empresa C13');
  await entrar(lojista, email);
  await lojista.goto('/publicacao/contas');
  await expect(lojista.getByTitle('Vídeo: como conectar a conta Apple')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  );
  await expect(lojista.getByTitle('Vídeo: como conectar a conta Google')).toHaveAttribute(
    'src',
    'https://player.vimeo.com/video/123456789',
  );

  // Sem o vídeo, o cartão fica só com os passos escritos — e não um player vazio.
  await videoDaApple.fill('');
  await salvar.click();
  /*
   * O "Chaves salvas." do envio anterior continua na tela enquanto este
   * grava: esperar por ele não espera nada. Quem diz que gravou é o banco.
   */
  await expect
    .poll(async () => {
      const { data } = await bancoDeTeste()
        .from('platform_settings')
        .select('valor')
        .eq('chave', 'video_da_apple')
        .maybeSingle();
      return data?.valor;
    })
    .toBe('');
  await lojista.reload();
  await expect(lojista.getByTitle('Vídeo: como conectar a conta Apple')).toHaveCount(0);
  await expect(lojista.getByText('Usuários e Acesso', { exact: false })).toBeVisible();
  await expect(lojista.getByTitle('Vídeo: como conectar a conta Google')).toBeVisible();
});

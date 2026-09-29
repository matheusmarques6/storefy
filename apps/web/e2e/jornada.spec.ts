/**
 * A jornada principal, de ponta a ponta e só pela tela (Fase 8): criar a
 * conta, criar a loja, montar o app no editor, publicar e agendar a primeira
 * campanha.
 *
 * Cada pedaço tem o seu teste, com os casos de erro. Este prova outra coisa:
 * que eles se encaixam na ordem em que o lojista os encontra — que quem chega
 * hoje vai do cadastro à primeira campanha sem precisar de ninguém. Os dados
 * conferidos no fim são os que a tela gravou, e não os que o teste plantou.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  MOTIVO_PULO,
  SENHA_PADRAO,
  SUPABASE_DISPONIVEL,
  bancoDeTeste,
  criarLojaPelaTela,
  emailDeTeste,
  limparUsuariosDeTeste,
} from './apoio';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

/** Espera o React assumir os campos antes de digitar (ver `push.spec.ts`). */
async function abrir(page: Page, caminho: string): Promise<void> {
  await page.goto(caminho);
  await page.waitForLoadState('networkidle');
}

/** A data de amanhã no horário de Brasília ("2026-09-30"). */
function amanhaEmBrasilia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    Date.now() + 86_400_000,
  );
}

test('do cadastro à primeira campanha, só pela tela', async ({ page }) => {
  const sufixo = Math.random().toString(36).slice(2, 8);
  const email = emailDeTeste('jornada');
  const empresa = `Jornada ${sufixo}`;

  // 1. A conta: o cadastro cria a empresa e entra direto no painel.
  await abrir(page, '/cadastrar');
  await page.getByLabel('Nome da sua empresa').fill(empresa);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA_PADRAO);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.waitForURL('/');
  await expect(page.getByRole('heading', { name: `Olá, ${empresa}` })).toBeVisible();
  await expect(page.getByText('Vamos colocar sua primeira loja no ar.')).toBeVisible();

  // 2. A primeira loja.
  const lojaId = await criarLojaPelaTela(page, `Loja ${sufixo}`, `loja-${sufixo}.com.br`);
  await abrir(page, '/');
  await expect(page.getByText('Você tem 1 loja cadastrada.')).toBeVisible();

  // 3. O app no editor: a cor da marca, salva e publicada.
  await abrir(page, '/app');
  await page.getByRole('button', { name: 'Aparência' }).click();
  await page.getByRole('textbox', { name: 'Cor principal', exact: true }).fill('#1d4ed8');
  // O rascunho se salva sozinho, um instante depois da última mudança.
  await expect(page.getByText(/Rascunho salvo às/)).toBeVisible();
  await page.getByRole('button', { name: /Publicar alterações/ }).click();
  await page.getByRole('button', { name: 'Publicar agora' }).click();
  await expect(page.getByText(/Versão \d+ publicada/)).toBeVisible();

  // O que foi ao ar é o que o lojista escolheu, na config que o app baixa.
  const { data: app } = await bancoDeTeste()
    .from('apps')
    .select('id')
    .eq('store_id', lojaId)
    .single();
  if (app == null) throw new Error('A loja criada pela tela ficou sem app.');
  const { data: publicada } = await bancoDeTeste()
    .from('app_configs')
    .select('config')
    .eq('app_id', app.id)
    .eq('status', 'published')
    .single();
  expect((publicada?.config as { theme: { primary: string } }).theme.primary).toBe('#1d4ed8');

  // 4. A publicação reconhece a config no ar — nas duas lojas de aplicativos.
  await abrir(page, '/publicacao');
  const configNoAr = page.getByRole('listitem').filter({ hasText: 'Configuração publicada' });
  await expect(configNoAr).toHaveCount(2);
  for (const item of await configNoAr.all()) await expect(item).toContainText('Pronto:');

  // 5. A primeira campanha, para amanhã às 20:00 da loja.
  const titulo = `Primeira ${sufixo}`;
  await abrir(page, '/push/nova');
  await page.getByLabel('Título', { exact: true }).fill(titulo);
  await page.getByLabel('Mensagem', { exact: true }).fill('Chegou a coleção nova. Vem ver!');
  await page.getByLabel('Data e hora do envio').fill(`${amanhaEmBrasilia()}T20:00`);
  await page.getByRole('button', { name: 'Agendar campanha' }).click();
  await page.waitForURL('/push');
  await expect(page.getByText('Campanha agendada.')).toBeVisible();

  const linha = page.getByRole('listitem').filter({ hasText: titulo });
  await expect(linha.getByText('Agendada', { exact: true })).toBeVisible();
  await expect(linha.locator('time')).toContainText('20:00');

  const { data: campanha } = await bancoDeTeste()
    .from('push_campaigns')
    .select('status, app_id')
    .eq('title', titulo)
    .single();
  expect(campanha).toEqual({ status: 'scheduled', app_id: app.id });
});

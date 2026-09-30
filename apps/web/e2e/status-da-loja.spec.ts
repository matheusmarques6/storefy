/**
 * O status da loja segue o app (C05 e A02): vem dos builds, pelo banco.
 *
 * Antes, toda loja era "Rascunho" para sempre — com o app aprovado nas duas
 * lojas —, e o resumo do admin dizia zero apps no ar. Os builds aqui são
 * plantados direto no banco, no papel do workflow e do cron da revisão: o que
 * se confere é o que o lojista lê no painel.
 */
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
} from './apoio';
import { varrer } from './axe';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

test('o status da loja segue o app: gerando, em revisão, recusado e no ar', async ({ page }) => {
  const email = emailDeTeste('status-loja');
  await criarUsuarioConfirmado(email, 'Empresa Status');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja do Status', 'loja-do-status.com.br');

  const { data: app, error } = await bancoDeTeste()
    .from('apps')
    .select('id')
    .eq('store_id', lojaId)
    .single();
  if (error != null) throw new Error(error.message);

  const suasLojas = page.getByRole('region', { name: 'Suas lojas' });
  async function status(esperado: string) {
    await page.goto('/');
    await expect(suasLojas.getByText(esperado, { exact: true })).toBeVisible();
  }

  await status('Rascunho');

  const { data: build, error: erroDoBuild } = await bancoDeTeste()
    .from('builds')
    .insert({ app_id: app.id, platform: 'ios', profile: 'production', status: 'queued' })
    .select('id')
    .single();
  if (erroDoBuild != null) throw new Error(erroDoBuild.message);
  await status('Gerando app');

  await bancoDeTeste()
    .from('builds')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', build.id);
  await status('Em revisão');

  // Recusado pede ação: o cartão diz onde está o motivo.
  await bancoDeTeste().from('builds').update({ status: 'rejected' }).eq('id', build.id);
  await status('Revisão recusada');
  await expect(suasLojas.getByText(/A revisão recusou o app/)).toBeVisible();
  await varrer(page, 'início com a loja recusada');

  // Corrigido e aprovado: no ar, também na lista de lojas.
  await bancoDeTeste()
    .from('builds')
    .insert({ app_id: app.id, platform: 'ios', profile: 'production', status: 'approved' });
  await status('No ar');
  await expect(suasLojas.getByText(/A revisão recusou o app/)).toHaveCount(0);
  await page.goto('/lojas');
  await expect(page.getByText('No ar', { exact: true })).toBeVisible();
  await varrer(page, 'lojas com a loja no ar');
});

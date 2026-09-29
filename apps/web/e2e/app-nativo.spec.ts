/**
 * O Face ID da aba Conta (C06e) e o que ele muda fora do editor: as notas
 * para a revisão da Apple (C12) e a política de privacidade pública.
 *
 * As duas saem da config NO AR, e não do rascunho — é a que o revisor e o
 * cliente final abrem. O teste prova as duas pontas: antes de publicar, nada
 * muda; depois, as duas contam o recurso.
 */
import { expect, test } from '@playwright/test';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  criarLojaPelaTela,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
} from './apoio';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);

test.afterAll(async () => {
  await limparUsuariosDeTeste();
});

test('o lojista liga o Face ID, publica, e a ficha e a política passam a contar isso', async ({
  page,
}) => {
  const email = emailDeTeste('faceid');
  await criarUsuarioConfirmado(email, 'Empresa Face ID');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Face ID', 'loja-faceid.com.br');

  // Antes da primeira publicação, as notas não existem — e a tela diz por quê.
  await page.goto('/publicacao');
  const notas = page.getByRole('region', { name: 'Notas para a revisão da Apple' });
  await expect(notas.getByText(/Publique o app no/)).toBeVisible();

  // No editor: a chave existe, começa desligada e explica o que faz.
  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Recursos' }).click();
  const chave = page.getByRole('switch', { name: 'Proteger a conta com Face ID ou digital' });
  await expect(chave).not.toBeChecked();
  await expect(
    page.getByText(/o cliente confirma com o rosto, a digital ou a senha/),
  ).toBeVisible();

  // Liga, salva e publica.
  await chave.click();
  await expect(chave).toBeChecked();
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByText('Rascunho salvo.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByRole('button', { name: 'Publicar agora' }).click();
  await expect(page.getByText(/Versão \d+ publicada/)).toBeVisible();

  // A ficha monta as notas da config no ar, em inglês, com o que o app tem.
  await page.goto('/publicacao');
  await expect(notas.getByText('App Store Connect › App Review Information')).toBeVisible();
  const texto = (await notas.locator('pre').textContent()) ?? '';
  expect(texto).toMatch(/^This is the official app of Loja Face ID \(loja-faceid\.com\.br\)/);
  expect(texto).toContain('Native tab bar ("Início", "Buscar", "Carrinho", "Conta")');
  expect(texto).toContain('Face ID / Touch ID protection for the "Conta" tab');
  // Sem push configurado, nada de prometer notificação ao revisor.
  expect(texto).not.toMatch(/notification/i);
  await expect(notas.getByText(`${String(texto.length)}/4000`)).toBeVisible();

  // A política pública conta o Face ID, e que a biometria não sai do celular.
  await page.goto(`/privacy/${lojaId}`);
  await expect(page.getByRole('heading', { name: 'Face ID e digital' })).toBeVisible();
  await expect(page.getByText(/A sua biometria nunca sai do aparelho/)).toBeVisible();

  /*
   * Sem a aba Conta não há o que proteger: a chave explica e continua podendo
   * ser DESLIGADA — ninguém fica com um recurso ligado que não desliga.
   */
  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Abas' }).click();
  await page.getByRole('button', { name: 'Remover Conta' }).click();
  await page.getByRole('button', { name: 'Recursos' }).click();
  await expect(page.getByText(/Precisa da aba Conta, que é a parte protegida/)).toBeVisible();
  await expect(chave).toBeChecked();
  await expect(chave).toBeEnabled();
  await chave.click();
  await expect(chave).not.toBeChecked();
  await expect(chave).toBeDisabled();

  /*
   * Salvo como RASCUNHO, o desligado ainda não está nos celulares: a política
   * e as notas seguem a config publicada, que continua com o Face ID.
   */
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByText('Rascunho salvo.').first()).toBeVisible();
  await page.goto(`/privacy/${lojaId}`);
  await expect(page.getByRole('heading', { name: 'Face ID e digital' })).toBeVisible();
  await page.goto('/publicacao');
  await expect(notas.locator('pre')).toContainText('Face ID / Touch ID protection');
});

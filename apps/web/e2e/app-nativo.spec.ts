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
  bancoDeTeste,
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

/*
 * Os links da loja abrindo no app (C12). O vínculo em si fala com a Shopify e
 * tem teste de unidade contra uma Admin API falsa; aqui entra o que o lojista
 * vê e faz: o que falta, a impressão do Android conferida e guardada, e os
 * arquivos prontos para quem não é Shopify.
 */
test('links da loja: a tela diz o que falta, confere a impressão do Android e entrega os arquivos', async ({
  page,
}) => {
  const email = emailDeTeste('links');
  await criarUsuarioConfirmado(email, 'Empresa Links');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Links', 'loja-links.com.br');

  await page.goto('/publicacao');
  const links = page.getByRole('region', { name: 'Links da loja abrindo no app' });

  // Sem a Shopify conectada, nada a vincular — e o caminho está ali.
  await expect(links.getByText(/Conecte a loja à Shopify em Integrações/)).toBeVisible();
  await expect(links.getByRole('link', { name: 'Ir para Integrações' })).toHaveAttribute(
    'href',
    '/integracoes',
  );
  await expect(links.getByRole('button', { name: /Vincular/ })).toHaveCount(0);
  // Cada plataforma diz o que falta, antes do primeiro build.
  await expect(links.getByText(/identificador do app no iPhone/)).toBeVisible();
  await expect(links.getByText(/identificador do app no Android/)).toBeVisible();

  // Impressão errada é recusada com a explicação, e nada é gravado.
  const campo = links.getByLabel('Impressão digital do certificado do Android (SHA-256)');
  await campo.fill('isto-nao-e-uma-impressao');
  await links.getByRole('button', { name: 'Salvar impressão' }).click();
  await expect(page.getByText(/não parece a impressão digital SHA-256/)).toBeVisible();

  // A do Play Console, colada sem os dois-pontos, é aceita e guardada formatada.
  const impressao =
    '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';
  await campo.fill(impressao.replace(/:/g, '').toLowerCase());
  await links.getByRole('button', { name: 'Salvar impressão' }).click();
  await expect(page.getByText('Impressão digital salva.')).toBeVisible();
  await page.reload();
  await expect(campo).toHaveValue(impressao);

  const banco = bancoDeTeste();
  const { data: app } = await banco
    .from('apps')
    .select('android_cert_fingerprints')
    .eq('store_id', lojaId)
    .single();
  expect(app?.android_cert_fingerprints).toEqual([impressao]);

  /*
   * Loja fora da Shopify: o lojista publica os arquivos no próprio site, e a
   * tela os entrega prontos. Os identificadores que o primeiro build definiria
   * são gravados direto, como o workflow de build gravaria.
   */
  await banco.from('stores').update({ platform: 'other' }).eq('id', lojaId);
  await banco
    .from('apps')
    .update({
      bundle_id_ios: 'me.convertfy.lojalinks',
      package_android: 'me.convertfy.lojalinks',
      apple_team_id: 'A1B2C3D4E5',
    })
    .eq('store_id', lojaId);

  await page.reload();
  await expect(links.getByText(/Conecte a loja à Shopify/)).toHaveCount(0);
  await expect(
    links.getByText('https://loja-links.com.br/.well-known/apple-app-site-association'),
  ).toBeVisible();
  await expect(
    links.getByText('https://loja-links.com.br/.well-known/assetlinks.json'),
  ).toBeVisible();
  const arquivos = await links.locator('pre').allTextContents();
  expect(arquivos.join('\n')).toContain('"A1B2C3D4E5.me.convertfy.lojalinks"');
  expect(arquivos.join('\n')).toContain(`"${impressao}"`);
  // Fora da Shopify, não há o que mandar a Shopify publicar.
  await expect(links.getByRole('button', { name: /Vincular/ })).toHaveCount(0);
});

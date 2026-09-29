/**
 * O editor salva sozinho e conta o que vai ao ar (C06, seção 10 do plano).
 *
 * O rascunho grava um instante depois da última mudança, sem botão; o que tem
 * ponto a corrigir não grava; e "Publicar alterações" diz quantas mudanças vão
 * ao ar — e só destrava com o rascunho salvo. A moldura da prévia troca entre
 * iPhone e Android e lembra a escolha de quem olha.
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

async function rascunhoNoBanco(lojaId: string) {
  const { data: app } = await bancoDeTeste()
    .from('apps')
    .select('id')
    .eq('store_id', lojaId)
    .single();
  const { data, error } = await bancoDeTeste()
    .from('app_configs')
    .select('config')
    .eq('app_id', app?.id ?? '')
    .eq('status', 'draft')
    .single();
  if (error != null) throw new Error(error.message);
  return data.config as {
    theme: { primary: string };
    tabs: { id: string; label: string }[];
    announcement?: { enabled: boolean; text: string; url?: string };
  };
}

test('o rascunho se salva sozinho, e o botão de publicar conta as mudanças', async ({ page }) => {
  const email = emailDeTeste('editor');
  await criarUsuarioConfirmado(email, 'Empresa Editor');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Editor', 'loja-editor.com.br');

  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  const barra = page.getByRole('region', { name: 'Publicação do app' });
  const publicar = barra.getByRole('button', { name: /Publicar alterações/ });
  const cor = page.getByRole('textbox', { name: 'Cor principal', exact: true });
  const corOriginal = await cor.inputValue();

  // O rascunho nasce salvo, e a primeira publicação já é possível.
  await expect(barra.getByText('Ainda não publicado', { exact: false })).toBeVisible();
  await publicar.click();
  await page.getByRole('button', { name: 'Publicar agora' }).click();
  await expect(page.getByText(/Versão \d+ publicada/)).toBeVisible();
  await expect(barra.getByText('Igual à versão no ar')).toBeVisible();
  await expect(publicar).toBeDisabled();

  // A moldura abre no iPhone e troca para o Android sem mexer no rascunho.
  const aparelhos = page.getByRole('group', { name: 'Aparelho da prévia' });
  const moldura = page.locator('[data-aparelho]');
  await expect(moldura).toHaveAttribute('data-aparelho', 'iphone');
  await aparelhos.getByRole('button', { name: 'Android' }).click();
  await expect(moldura).toHaveAttribute('data-aparelho', 'android');
  await expect(aparelhos.getByRole('button', { name: 'Android' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(barra.getByText('Igual à versão no ar')).toBeVisible();

  // Mudar a cor grava sozinho — sem botão —, e o contador mostra uma mudança.
  await page.getByRole('textbox', { name: 'Cor principal', exact: true }).fill('#be123c');
  await expect(barra.getByText('Salvando o rascunho…')).toBeVisible();
  await expect(barra.getByText(/Rascunho salvo às/)).toBeVisible();
  await expect(barra.getByText('1 mudança desde a versão no ar')).toBeVisible();
  await expect(publicar).toBeEnabled();
  expect((await rascunhoNoBanco(lojaId)).theme.primary).toBe('#be123c');

  // Recarregar não perde nada: a cor estava no banco, e o aparelho, no navegador.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('textbox', { name: 'Cor principal', exact: true })).toHaveValue(
    '#be123c',
  );
  await expect(barra.getByText('1 mudança desde a versão no ar')).toBeVisible();
  await expect(moldura).toHaveAttribute('data-aparelho', 'android');
  await aparelhos.getByRole('button', { name: 'iPhone' }).click();
  await expect(moldura).toHaveAttribute('data-aparelho', 'iphone');

  // Um ponto a corrigir segura a gravação: duas abas com o mesmo nome.
  await page.getByRole('button', { name: 'Abas' }).click();
  await page.locator('#aba-busca-nome').fill('Início');
  await expect(
    barra.getByText('Corrija os pontos destacados para o rascunho ser salvo.'),
  ).toBeVisible();
  await expect(publicar).toBeDisabled();
  await page.waitForTimeout(2500);
  expect((await rascunhoNoBanco(lojaId)).tabs.find((aba) => aba.id === 'busca')?.label).toBe(
    'Buscar',
  );

  // Corrigido, grava sozinho e conta duas mudanças.
  await page.locator('#aba-busca-nome').fill('Procurar');
  await expect(barra.getByText(/Rascunho salvo às/)).toBeVisible();
  await expect(barra.getByText('2 mudanças desde a versão no ar')).toBeVisible();
  expect((await rascunhoNoBanco(lojaId)).tabs.find((aba) => aba.id === 'busca')?.label).toBe(
    'Procurar',
  );

  await publicar.click();
  await page.getByRole('button', { name: 'Publicar agora' }).click();
  await expect(page.getByText(/Versão \d+ publicada/)).toBeVisible();
  await expect(barra.getByText('Igual à versão no ar')).toBeVisible();

  // Restaurar a primeira versão troca o que está na tela — não é a volta de
  // uma gravação — e o contador mostra o que difere do que está no ar.
  await page.getByRole('button', { name: 'Versões' }).click();
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Histórico' })
    .getByRole('button', { name: 'Restaurar' })
    .click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText(/carregada no rascunho/)).toBeVisible();
  await expect(barra.getByText('2 mudanças desde a versão no ar')).toBeVisible();
  await page.getByRole('button', { name: 'Aparência' }).click();
  await expect(cor).toHaveValue(corOriginal);
  const restaurado = await rascunhoNoBanco(lojaId);
  expect(restaurado.theme.primary).toBe(corOriginal);
  expect(restaurado.tabs.find((aba) => aba.id === 'busca')?.label).toBe('Buscar');
});

test('o que se digita com uma gravação a caminho não se perde quando ela volta', async ({
  page,
}) => {
  const email = emailDeTeste('editor-voo');
  await criarUsuarioConfirmado(email, 'Empresa Editor Voo');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Editor Voo', 'loja-editor-voo.com.br');

  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  const barra = page.getByRole('region', { name: 'Publicação do app' });

  // A primeira gravação fica presa no caminho até o teste soltá-la: dá tempo
  // de mexer em outra coisa com ela indo e voltando.
  let soltar!: () => void;
  const presa = new Promise<void>((pronto) => {
    soltar = pronto;
  });
  await page.route('**/app', async (rota) => {
    if (rota.request().method() === 'POST') await presa;
    await rota.continue();
  });

  await page.getByRole('button', { name: 'Abas' }).click();
  const primeira = page.waitForRequest(
    (pedido) => pedido.method() === 'POST' && pedido.headers()['next-action'] !== undefined,
  );
  await page.locator('#aba-inicio-nome').fill('Loja');
  const pedido = await primeira;

  // Digitado com a gravação a caminho, e ela volta antes da pausa acabar.
  const nome = page.locator('#aba-busca-nome');
  await nome.fill('Procurar');
  soltar();
  await pedido.response();
  await page.waitForTimeout(400);
  expect(await nome.inputValue()).toBe('Procurar');
  await expect(page.locator('#aba-inicio-nome')).toHaveValue('Loja');

  // E vai para o banco na gravação seguinte.
  await expect(barra.getByText(/Rascunho salvo às/)).toBeVisible();
  await expect
    .poll(async () => (await rascunhoNoBanco(lojaId)).tabs.map((aba) => aba.label).join(','))
    .toContain('Loja,Procurar');
  await page.unroute('**/app');

  // Sair da tela logo depois de mudar não perde a mudança: a gravação sai na hora.
  await page.getByRole('button', { name: 'Aparência' }).click();
  await page.getByRole('textbox', { name: 'Cor principal', exact: true }).fill('#7c3aed');
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('link', { name: 'Início' })
    .click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect
    .poll(async () => (await rascunhoNoBanco(lojaId)).theme.primary, { timeout: 10_000 })
    .toBe('#7c3aed');
});

test('o aviso no topo: liga, confere texto e link, aparece na prévia e grava', async ({ page }) => {
  const email = emailDeTeste('editor-aviso');
  await criarUsuarioConfirmado(email, 'Empresa Editor Aviso');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Editor Aviso', 'loja-editor-aviso.com.br');

  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  const barra = page.getByRole('region', { name: 'Publicação do app' });
  await page.getByRole('button', { name: 'Recursos' }).click();
  await page.getByRole('switch', { name: 'Aviso no topo' }).click();

  // Ligado sem texto não grava, e diz por quê.
  await expect(
    page.getByText('O aviso no topo está ligado, mas sem texto. Escreva o que ele deve dizer.'),
  ).toBeVisible();
  await expect(
    barra.getByText('Corrija os pontos destacados para o rascunho ser salvo.'),
  ).toBeVisible();

  // O texto aparece na prévia enquanto é digitado.
  await page.getByLabel('Texto do aviso').fill('Frete grátis acima de R$ 199');
  await expect(page.getByTestId('aviso-na-previa')).toHaveText('Frete grátis acima de R$ 199');
  await expect(page.getByText('28 de 80 caracteres.')).toBeVisible();

  // Link de fora da loja é recusado, com o exemplo do que vale.
  const link = page.getByLabel('Link do aviso (opcional)');
  await link.fill('https://instagram.com/loja');
  await expect(
    page.getByText(
      'O link do aviso precisa ser um endereço da sua loja, como /collections/promocao.',
    ),
  ).toBeVisible();
  await page.waitForTimeout(1500);
  expect((await rascunhoNoBanco(lojaId)).announcement?.url).toBeUndefined();

  // Um caminho da loja vale, e o rascunho grava sozinho.
  await link.fill('/collections/promocao');
  await expect(barra.getByText(/Rascunho salvo às/)).toBeVisible();
  expect((await rascunhoNoBanco(lojaId)).announcement).toEqual({
    enabled: true,
    text: 'Frete grátis acima de R$ 199',
    url: '/collections/promocao',
  });
  await expect(barra.getByText('Ainda não publicado', { exact: false })).toBeVisible();

  // Desligar tira da prévia e grava, mas guarda o texto para a próxima vez.
  await page.getByRole('switch', { name: 'Aviso no topo' }).click();
  await expect(page.getByTestId('aviso-na-previa')).toHaveCount(0);
  await expect(barra.getByText(/Rascunho salvo às/)).toBeVisible();
  await expect.poll(async () => (await rascunhoNoBanco(lojaId)).announcement?.enabled).toBe(false);
  expect((await rascunhoNoBanco(lojaId)).announcement?.text).toBe('Frete grátis acima de R$ 199');
});

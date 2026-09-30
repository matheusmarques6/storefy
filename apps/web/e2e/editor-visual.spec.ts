/**
 * O acabamento do editor (C06), da seção 10 do plano e do A10.
 *
 * Três colunas na tela larga; a Inter carregada de verdade (antes o CSS só a
 * pedia); o ícone e a abertura na prévia, como o celular mostra; o número
 * sobre o ícone da aba escolhido pelo lojista (C06b); o aviso de contraste; e
 * o preset do tema da loja em primeiro (A10).
 */
import type { Page } from '@playwright/test';
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
import { pngDeCorLisa } from './imagens';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

async function abrirEditor(page: Page, rotulo: string): Promise<string> {
  const email = emailDeTeste(rotulo);
  await criarUsuarioConfirmado(email, `Empresa ${rotulo}`);
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, `Loja ${rotulo}`, `loja-${rotulo}-e2e.com.br`);
  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  return lojaId;
}

function secao(page: Page, nome: string) {
  return page
    .getByRole('navigation', { name: 'Seções do editor' })
    .getByRole('button', { name: nome });
}

async function rascunho(lojaId: string) {
  const banco = bancoDeTeste();
  const { data: app } = await banco.from('apps').select('id').eq('store_id', lojaId).single();
  const { data, error } = await banco
    .from('app_configs')
    .select('config')
    .eq('app_id', app?.id ?? '')
    .eq('status', 'draft')
    .single();
  if (error != null) throw new Error(error.message);
  return data.config as { tabs: { id: string; type: string; badge: string }[] };
}

test('três colunas na tela larga, duas na média, e a Inter carregada', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await abrirEditor(page, 'colunas');

  const nav = page.getByRole('navigation', { name: 'Seções do editor' });
  const moldura = page.locator('[data-aparelho]');
  const propriedades = page.getByText('Nome, ícone, tela de abertura, cores e barra de status.');

  const [caixaDaNav, caixaDasPropriedades, caixaDaMoldura] = await Promise.all([
    nav.boundingBox(),
    propriedades.boundingBox(),
    moldura.boundingBox(),
  ]);
  if (caixaDaNav === null || caixaDasPropriedades === null || caixaDaMoldura === null) {
    throw new Error('colunas do editor sem caixa');
  }
  // Seções · propriedades · celular, lado a lado.
  expect(caixaDaNav.x + caixaDaNav.width).toBeLessThanOrEqual(caixaDasPropriedades.x);
  expect(caixaDasPropriedades.x).toBeLessThan(caixaDaMoldura.x);

  // Na média, as seções sobem para uma faixa em cima das propriedades.
  await page.setViewportSize({ width: 1100, height: 900 });
  const [navMedia, propriedadesMedia] = await Promise.all([
    nav.boundingBox(),
    propriedades.boundingBox(),
  ]);
  if (navMedia === null || propriedadesMedia === null) throw new Error('sem caixa na média');
  expect(navMedia.y + navMedia.height).toBeLessThanOrEqual(propriedadesMedia.y);

  // A Inter chega de verdade, servida pelo painel — e não a fonte do sistema.
  const inter = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      carregada: [...document.fonts].some(
        (fonte) => fonte.family.includes('Inter') && fonte.status === 'loaded',
      ),
      noCorpo: getComputedStyle(document.body).fontFamily,
    };
  });
  expect(inter.carregada).toBe(true);
  expect(inter.noCorpo).toContain('Inter');
});

test('a prévia mostra o ícone na tela inicial e a abertura, com e sem imagem', async ({ page }) => {
  await abrirEditor(page, 'identidade-previa');
  const vistas = page.getByRole('group', { name: 'O que ver na prévia' });
  const telaInicial = page.getByTestId('tela-inicial-na-previa');

  // Sem ícone ainda: o lugar dele, com o caminho para enviar.
  await vistas.getByRole('button', { name: 'Ícone' }).click();
  await expect(telaInicial).toBeVisible();
  await expect(telaInicial.getByText('Envie o ícone em Aparência')).toBeVisible();
  await expect(page.getByTestId('nome-na-tela-inicial')).toHaveText('Loja identidade-previa');
  await expect(page.getByTitle('Prévia da loja dentro do app')).toBeHidden();

  await vistas.getByRole('button', { name: 'Abertura' }).click();
  await expect(page.getByTestId('abertura-na-previa')).toContainText(
    'Sem imagem de abertura, o app abre numa tela branca.',
  );

  // Com o ícone enviado, ele aparece recortado pelo aparelho.
  await page.locator('#imagem-icone').setInputFiles({
    name: 'icone.png',
    mimeType: 'image/png',
    buffer: pngDeCorLisa(1024, 1024),
  });
  await expect(page.getByText('Ícone atualizado', { exact: false })).toBeVisible();
  await vistas.getByRole('button', { name: 'Ícone' }).click();
  await expect(telaInicial.locator('img')).toHaveCount(2);
  await expect(
    telaInicial.getByText('No iPhone, o ícone ganha os cantos arredondados.'),
  ).toBeVisible();
  await page
    .getByRole('group', { name: 'Aparelho da prévia' })
    .getByRole('button', { name: 'Android' })
    .click();
  await expect(
    telaInicial.getByText('No Android, o ícone é recortado em círculo: só o miolo aparece.'),
  ).toBeVisible();

  // De volta à loja, a página continua lá.
  await vistas.getByRole('button', { name: 'Loja' }).click();
  await expect(page.getByTitle('Prévia da loja dentro do app')).toBeVisible();
  await expect(telaInicial).toHaveCount(0);
});

test('o número sobre o ícone da aba liga e desliga, na prévia e no rascunho', async ({ page }) => {
  const lojaId = await abrirEditor(page, 'numero-da-aba');
  // A versão de partida vai ao ar: o que for publicado depois é comparado com ela.
  const barra = page.getByRole('region', { name: 'Publicação do app' });
  await barra.getByRole('button', { name: /Publicar alterações/ }).click();
  await page.getByRole('button', { name: 'Publicar agora' }).click();
  await expect(page.getByText(/Versão \d+ publicada/)).toBeVisible();
  await secao(page, 'Abas').click();

  const chave = page.getByRole('switch', { name: 'Mostrar o número de itens sobre o ícone' });
  const selo = page.getByTestId('selo-carrinho');
  await expect(chave).toHaveAttribute('aria-checked', 'true');
  await expect(selo).toBeVisible();

  await chave.click();
  await expect(chave).toHaveAttribute('aria-checked', 'false');
  await expect(selo).toHaveCount(0);
  await expect(barra.getByText(/Rascunho salvo às/)).toBeVisible();
  await expect
    .poll(async () => (await rascunho(lojaId)).tabs.find((aba) => aba.type === 'cart')?.badge)
    .toBe('none');

  // O que vai ao ar diz o que mudou, na língua do lojista.
  await barra.getByRole('button', { name: /Publicar alterações/ }).click();
  await expect(
    page.getByRole('alertdialog').getByText('Aba “Carrinho”: sem o número do carrinho'),
  ).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar' }).click();

  // Abas sem o que contar não têm a chave.
  await expect(page.getByRole('switch', { name: /Mostrar/ })).toHaveCount(1);
});

test('cores difíceis de ler ganham aviso, com o conserto da barra de status', async ({ page }) => {
  await abrirEditor(page, 'contraste');
  const aviso = page.getByTestId('aviso-de-contraste');

  // O tema com que toda loja começa não tem aviso.
  await expect(aviso).toHaveCount(0);

  await page.getByRole('textbox', { name: 'Abas não selecionadas', exact: true }).fill('#e5e7eb');
  await expect(aviso).toContainText('As abas que não estão abertas: contraste de 1,2:1');
  await expect(aviso).toContainText('o mínimo para ler bem é 3:1');

  await page.getByRole('textbox', { name: 'Abas não selecionadas', exact: true }).fill('#4b5563');
  await expect(aviso).toHaveCount(0);

  // Fundo escuro com os ícones escuros da barra de status: o aviso diz o conserto.
  await page.getByRole('textbox', { name: 'Fundo', exact: true }).fill('#0f172a');
  await expect(aviso).toContainText('Escolha "Ícones claros" em Barra de status.');
});

test('A10: o preset do tema da loja vem primeiro, marcado, e a leitura que falha diz o porquê', async ({
  page,
}) => {
  const banco = bancoDeTeste();
  const abas = [
    { id: 'inicio', label: 'Início', icon: 'house', type: 'webview', url: '/', badge: 'none' },
    {
      id: 'carrinho',
      label: 'Carrinho',
      icon: 'shopping-bag',
      type: 'cart',
      badge: 'cart_count',
    },
  ];
  const { data: criados, error } = await banco
    .from('config_presets')
    .insert([
      { nome: 'Impulse — teste e2e', tema: 'Impulse', tabs: abas },
      { nome: 'Dawn — teste e2e', tema: 'Dawn', tabs: abas },
    ])
    .select('id');
  if (error != null) throw new Error(error.message);

  try {
    const lojaId = await abrirEditor(page, 'tema-da-loja');
    await secao(page, 'Loja').click();
    const tema = page.getByTestId('tema-da-loja');

    // Loja cadastrada sem a leitura do tema: o lojista pode pedir.
    await expect(tema).toHaveText('Ainda não sabemos qual tema a sua loja usa.');
    await page.getByRole('button', { name: 'Descobrir o tema da minha loja' }).click();
    // O endereço de teste não existe: a leitura falha, e diz o porquê.
    await expect(
      page.getByRole('alert').filter({ hasText: 'Não conseguimos acessar a loja' }),
    ).toBeVisible();

    // Com o tema conhecido (como o cadastro grava), o preset dele sobe, marcado.
    const { error: erroDoTema } = await banco
      .from('stores')
      .update({ shopify_theme: 'Dawn' })
      .eq('id', lojaId);
    if (erroDoTema != null) throw new Error(erroDoTema.message);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await secao(page, 'Loja').click();

    await expect(tema).toHaveText('Sua loja usa o tema Dawn.');
    const nomes = page.locator('li').filter({ hasText: 'teste e2e' });
    await expect(nomes.first()).toContainText('Dawn — teste e2e');
    await expect(nomes.first()).toContainText('Feito para o seu tema');
    await expect(nomes.filter({ hasText: 'Impulse' })).not.toContainText('Feito para o seu tema');
    await expect(page.getByRole('button', { name: 'Ler o tema de novo' })).toBeVisible();
  } finally {
    await banco
      .from('config_presets')
      .delete()
      .in(
        'id',
        criados.map((preset) => preset.id),
      );
  }
});

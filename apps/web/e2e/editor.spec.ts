/**
 * O editor salva sozinho e conta o que vai ao ar (C06, seção 10 do plano).
 *
 * O rascunho grava um instante depois da última mudança, sem botão; o que tem
 * ponto a corrigir não grava; e "Publicar alterações" diz quantas mudanças vão
 * ao ar — e só destrava com o rascunho salvo. A moldura da prévia troca entre
 * iPhone e Android e lembra a escolha de quem olha.
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
import { pngDeCorLisa } from './imagens';

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
    features: { onboardingSlides: { title: string; body: string; image: string }[] };
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

  // O diálogo de publicar diz, em frases, o que vai ao ar.
  await publicar.click();
  const aoPublicar = page.getByRole('alertdialog');
  await expect(aoPublicar.getByText('O que vai ao ar:')).toBeVisible();
  await varrer(page, 'a confirmação de publicar, com o que vai ao ar');
  await expect(aoPublicar.getByText(`Cor principal: ${corOriginal} → #be123c`)).toBeVisible();
  await expect(aoPublicar.getByText('Aba “Buscar” agora se chama “Procurar”')).toBeVisible();
  await aoPublicar.getByRole('button', { name: 'Publicar agora' }).click();
  await expect(page.getByText(/Versão \d+ publicada/)).toBeVisible();
  await expect(barra.getByText('Igual à versão no ar')).toBeVisible();

  // Comparar a primeira versão com o rascunho diz o que restaurá-la mudaria —
  // e restaurar dali troca o que está na tela, porque não é a volta de uma
  // gravação; o contador mostra o que difere do que está no ar.
  await page.getByRole('button', { name: 'Versões' }).click();
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Histórico' })
    .getByRole('button', { name: /Comparar a versão/ })
    .click();
  const comparacao = page.getByRole('dialog');
  await expect(comparacao.getByText(`Cor principal: #be123c → ${corOriginal}`)).toBeVisible();
  await expect(comparacao.getByText('Aba “Procurar” agora se chama “Buscar”')).toBeVisible();
  await comparacao.getByRole('button', { name: 'Restaurar esta versão' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText(/carregada no rascunho/)).toBeVisible();
  await expect(barra.getByText('2 mudanças desde a versão no ar')).toBeVisible();
  await page.getByRole('button', { name: 'Aparência' }).click();
  await expect(cor).toHaveValue(corOriginal);
  const restaurado = await rascunhoNoBanco(lojaId);
  expect(restaurado.theme.primary).toBe(corOriginal);
  expect(restaurado.tabs.find((aba) => aba.id === 'busca')?.label).toBe('Buscar');

  // "Desfazer mudanças" volta o rascunho ao que está no ar — com confirmação
  // que diz quantas se perdem —, e o salvamento automático grava.
  await barra.getByRole('button', { name: 'Desfazer mudanças' }).click();
  const confirmacao = page.getByRole('alertdialog');
  await expect(confirmacao.getByText('Desfazer as 2 mudanças?')).toBeVisible();
  await confirmacao.getByRole('button', { name: 'Desfazer mudanças' }).click();
  await expect(page.getByText('Mudanças desfeitas', { exact: false })).toBeVisible();
  await expect(cor).toHaveValue('#be123c');
  await expect(barra.getByText('Igual à versão no ar')).toBeVisible();
  await expect(barra.getByRole('button', { name: 'Desfazer mudanças' })).toHaveCount(0);
  await expect.poll(async () => (await rascunhoNoBanco(lojaId)).theme.primary).toBe('#be123c');
  expect((await rascunhoNoBanco(lojaId)).tabs.find((aba) => aba.id === 'busca')?.label).toBe(
    'Procurar',
  );
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

test('as abas mudam de ordem arrastando, e as setas não perdem o foco', async ({ page }) => {
  const email = emailDeTeste('editor-arraste');
  await criarUsuarioConfirmado(email, 'Empresa Editor Arraste');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Editor Arraste', 'loja-editor-arraste.com.br');

  // Alta o bastante para a lista inteira caber: o arraste mira pelas medidas da tela.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  const barra = page.getByRole('region', { name: 'Publicação do app' });
  const publicar = barra.getByRole('button', { name: /Publicar alterações/ });

  // Publicada a versão de partida, o que muda depois vira frase no "o que vai ao ar".
  await publicar.click();
  await page.getByRole('button', { name: 'Publicar agora' }).click();
  await expect(barra.getByText('Igual à versão no ar')).toBeVisible();
  await page.getByRole('button', { name: 'Abas' }).click();

  const ordemNaTela = () =>
    page
      .getByLabel('Nome na barra')
      .evaluateAll((campos) => campos.map((campo) => (campo as HTMLInputElement).value));
  // O nome de cada aba na barra da prévia (o selo do carrinho fica de fora).
  const ordemNaPrevia = () =>
    page.locator('[data-aparelho] button[aria-pressed] > span:last-child').allInnerTexts();
  const ordemNoBanco = async () => (await rascunhoNoBanco(lojaId)).tabs.map((aba) => aba.label);
  const anuncio = page.getByTestId('anuncio-das-abas');
  const alcas = page.getByTestId('alca-da-aba');
  const arrastada = page.locator('li[data-arrastada]');
  const linha = (id: string) =>
    page.getByRole('listitem').filter({ has: page.locator(`#aba-${id}-nome`) });

  await expect.poll(ordemNaTela).toEqual(['Início', 'Buscar', 'Carrinho', 'Conta']);
  await expect(
    page.getByText(
      'Para mudar a ordem, arraste a aba pelos pontinhos à esquerda ou use as setas.',
      {
        exact: false,
      },
    ),
  ).toBeVisible();

  /** Pega a aba pelos pontinhos e leva o ponteiro até `y`, em passos, como a mão faz. */
  async function pegarELevar(indice: number, y: number) {
    const caixa = await alcas.nth(indice).boundingBox();
    if (caixa === null) throw new Error('Os pontinhos da aba não estão na tela.');
    const x = caixa.x + caixa.width / 2;
    await page.mouse.move(x, caixa.y + caixa.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 12 });
  }

  // A Conta, arrastada para cima de tudo, vira a primeira: na lista, na prévia e no banco.
  const inicio = await linha('inicio').boundingBox();
  await pegarELevar(3, (inicio?.y ?? 0) + 4);
  await expect(arrastada).toHaveCount(1);
  await page.mouse.up();
  await expect(arrastada).toHaveCount(0);
  await expect.poll(ordemNaTela).toEqual(['Conta', 'Início', 'Buscar', 'Carrinho']);
  await expect.poll(ordemNaPrevia).toEqual(['Conta', 'Início', 'Buscar', 'Carrinho']);
  await expect(anuncio).toHaveText('“Conta” agora é a 1ª de 4 abas.');
  await expect(barra.getByText(/Rascunho salvo às/)).toBeVisible();
  await expect.poll(ordemNoBanco).toEqual(['Conta', 'Início', 'Buscar', 'Carrinho']);

  // Escape desiste no meio do caminho: a aba volta ao lugar e nada grava.
  const carrinho = await linha('carrinho').boundingBox();
  await pegarELevar(0, (carrinho?.y ?? 0) + (carrinho?.height ?? 0) + 30);
  await expect(arrastada).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(arrastada).toHaveCount(0);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  expect(await ordemNaTela()).toEqual(['Conta', 'Início', 'Buscar', 'Carrinho']);
  expect(await ordemNoBanco()).toEqual(['Conta', 'Início', 'Buscar', 'Carrinho']);

  // Pelas setas, com o teclado, o foco acompanha a aba — subindo e descendo —
  // e, quando ela chega ao topo, passa para a outra seta.
  const subirBuscar = page.getByRole('button', { name: 'Mover Buscar para cima' });
  const descerBuscar = page.getByRole('button', { name: 'Mover Buscar para baixo' });
  await subirBuscar.focus();
  await page.keyboard.press('Enter');
  await expect.poll(ordemNaTela).toEqual(['Conta', 'Buscar', 'Início', 'Carrinho']);
  await expect(subirBuscar).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(ordemNaTela).toEqual(['Buscar', 'Conta', 'Início', 'Carrinho']);
  await expect(subirBuscar).toBeDisabled();
  await expect(descerBuscar).toBeFocused();
  await expect(anuncio).toHaveText('“Buscar” agora é a 1ª de 4 abas.');
  await page.keyboard.press('Enter');
  await expect.poll(ordemNaTela).toEqual(['Conta', 'Buscar', 'Início', 'Carrinho']);
  await expect(descerBuscar).toBeFocused();
  await expect(anuncio).toHaveText('“Buscar” agora é a 2ª de 4 abas.');

  // Remover leva o foco para a aba que ficou no lugar.
  await page.getByRole('button', { name: 'Remover Início' }).click();
  await expect.poll(ordemNaTela).toEqual(['Conta', 'Buscar', 'Carrinho']);
  await expect(page.locator('#aba-carrinho-nome')).toBeFocused();
  await expect(anuncio).toHaveText('“Início” saiu da barra.');

  // Numa janela baixa, levar a aba até a borda de cima rola a página, e a aba
  // segue debaixo do ponteiro enquanto ela rola.
  await page.setViewportSize({ width: 1280, height: 560 });
  await alcas.nth(2).evaluate((alca) => {
    alca.scrollIntoView({ block: 'center' });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await pegarELevar(2, 30);
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 }).toBe(0);
  await expect
    .poll(async () => {
      const caixa = await arrastada.boundingBox();
      return caixa !== null && caixa.y <= 30 && caixa.y + caixa.height >= 30;
    })
    .toBe(true);
  await page.mouse.up();
  await expect.poll(ordemNaTela).toEqual(['Carrinho', 'Conta', 'Buscar']);

  // O que vai ao ar diz a ordem nova, e a de quem saiu.
  await expect(barra.getByText(/Rascunho salvo às/)).toBeVisible();
  await expect.poll(ordemNoBanco).toEqual(['Carrinho', 'Conta', 'Buscar']);
  await publicar.click();
  const aoPublicar = page.getByRole('alertdialog');
  await expect(aoPublicar.getByText('Aba removida: “Início”')).toBeVisible();
  await expect(aoPublicar.getByText('Nova ordem das abas: Carrinho, Conta, Buscar')).toBeVisible();
  await aoPublicar.getByRole('button', { name: 'Cancelar' }).click();

  // Quem é membro vê a ordem, mas não tem o que arrastar nem setas que funcionem.
  const membro = emailDeTeste('editor-arraste-membro');
  const membroId = await criarUsuarioConfirmado(membro, 'Pessoal Membro Arraste');
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
  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Abas' }).click();
  await expect.poll(ordemNaTela).toEqual(['Carrinho', 'Conta', 'Buscar']);
  await expect(alcas).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mover Conta para cima' })).toBeDisabled();
  await expect(page.getByText('Para mudar a ordem', { exact: false })).toHaveCount(0);
});

test('as telas de boas-vindas: imagem enviada e conferida, prévia fiel e rascunho salvo', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const email = emailDeTeste('editor-slides');
  await criarUsuarioConfirmado(email, 'Empresa Editor Slides');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Editor Slides', 'loja-editor-slides.com.br');

  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  const barra = page.getByRole('region', { name: 'Publicação do app' });
  const vistas = page.getByRole('group', { name: 'O que ver na prévia' });
  const previa = page.getByTestId('boas-vindas-na-previa');
  await page.getByRole('button', { name: 'Recursos' }).click();

  // Sem telas, a prévia nem oferece a vista.
  await expect(vistas.getByRole('button', { name: 'Boas-vindas' })).toHaveCount(0);

  // Adicionar leva a prévia até a tela nova, e a tela vazia não grava.
  await page.getByRole('button', { name: 'Adicionar tela' }).click();
  await expect(vistas.getByRole('button', { name: 'Boas-vindas' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(previa.getByText('Escreva o título')).toBeVisible();
  await expect(
    page.getByText('A tela de boas-vindas 1 está sem título ou sem texto.'),
  ).toBeVisible();

  // O texto aparece na prévia enquanto é digitado, com a conta do que cabe.
  await page.getByLabel('Título').fill('x'.repeat(41));
  await expect(page.getByText('41 de 40 caracteres.')).toBeVisible();
  await expect(
    page.getByText(
      'O título da tela de boas-vindas 1 passa de 40 caracteres e não cabe na tela do celular. Encurte o título.',
    ),
  ).toBeVisible();
  await page.getByLabel('Título').fill('Bem-vindo à loja');
  await page.getByLabel('Texto', { exact: true }).fill('Frete grátis na primeira compra pelo app.');
  await expect(previa.getByText('Bem-vindo à loja')).toBeVisible();
  await expect(previa.getByText('Frete grátis na primeira compra pelo app.')).toBeVisible();
  await expect(barra.getByText(/Rascunho salvo às/)).toBeVisible();

  // Uma imagem pequena demais é recusada, com o motivo embaixo do campo.
  await page.locator('#slide-0-imagem').setInputFiles({
    name: 'pequena.png',
    mimeType: 'image/png',
    buffer: pngDeCorLisa(120, 120),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'pequena demais' })).toBeVisible();

  // A boa sobe, reprocessada: aparece no campo e na prévia, e vai para o rascunho.
  await page.locator('#slide-0-imagem').setInputFiles({
    name: 'slide.png',
    mimeType: 'image/png',
    buffer: pngDeCorLisa(1200, 800),
  });
  await expect(page.getByRole('button', { name: 'Trocar imagem' })).toBeVisible();
  await expect(previa.getByRole('img', { name: 'Imagem da tela 1' })).toBeVisible();
  const caminho = new RegExp(
    `/storage/v1/object/public/imagens-do-app/${lojaId}/[0-9a-f-]{36}\\.jpg$`,
  );
  await expect
    .poll(async () => (await rascunhoNoBanco(lojaId)).features.onboardingSlides[0]?.image ?? '')
    .toMatch(caminho);

  // O endereço guardado abre sem sessão — é assim que o app do cliente o baixa.
  const url = (await rascunhoNoBanco(lojaId)).features.onboardingSlides[0]?.image ?? '';
  const baixada = await page.request.get(url, { headers: { cookie: '' } });
  expect(baixada.status()).toBe(200);
  expect(baixada.headers()['content-type']).toBe('image/jpeg');

  // Uma segunda tela: a prévia vai até ela, e os pontos voltam para a primeira.
  await page.getByRole('button', { name: 'Adicionar tela' }).click();
  await expect(previa.getByText('Escreva o título')).toBeVisible();
  await previa.getByRole('button', { name: 'Ver a tela 1' }).click();
  await expect(previa.getByText('Bem-vindo à loja')).toBeVisible();
  await expect(previa.getByRole('button', { name: 'Continuar' })).toBeVisible();
  await page.getByRole('button', { name: 'Remover tela 2' }).click();
  await expect(previa.getByRole('button', { name: 'Começar' })).toBeVisible();

  // Tirar a imagem deixa a tela só com texto, e o rascunho acompanha.
  await page.getByRole('button', { name: 'Tirar imagem da tela 1' }).click();
  await expect(previa.getByRole('img')).toHaveCount(0);
  await expect
    .poll(async () => (await rascunhoNoBanco(lojaId)).features.onboardingSlides)
    .toEqual([
      { title: 'Bem-vindo à loja', body: 'Frete grátis na primeira compra pelo app.', image: '' },
    ]);

  // "Pular", como no app, leva para a loja.
  await previa.getByRole('button', { name: 'Pular' }).click();
  await expect(vistas.getByRole('button', { name: 'Loja' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // A tela escrita só sai confirmando; "Cancelar" não mexe em nada.
  await page.getByRole('button', { name: 'Remover tela 1' }).click();
  const confirmacao = page.getByRole('alertdialog', { name: 'Remover a tela 1?' });
  await confirmacao.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByLabel('Título')).toHaveValue('Bem-vindo à loja');
  await page.getByRole('button', { name: 'Remover tela 1' }).click();
  await confirmacao.getByRole('button', { name: 'Remover' }).click();
  await expect(
    page.getByText('Nenhuma tela de boas-vindas. O cliente cai direto na loja.'),
  ).toBeVisible();
  await expect(vistas.getByRole('button', { name: 'Boas-vindas' })).toHaveCount(0);
  await expect
    .poll(async () => (await rascunhoNoBanco(lojaId)).features.onboardingSlides)
    .toEqual([]);
});

test('duas abas no mesmo rascunho: a desatualizada não apaga a outra, e a pessoa escolhe', async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  const email = emailDeTeste('editor-abas');
  await criarUsuarioConfirmado(email, 'Empresa Duas Abas');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Duas Abas', 'loja-duas-abas.com.br');
  const corNoBanco = async () => (await rascunhoNoBanco(lojaId)).theme.primary;
  const nomeNoBanco = async (id: string) =>
    (await rascunhoNoBanco(lojaId)).tabs.find((aba) => aba.id === id)?.label;
  const publicadas = async () => {
    const { data: app } = await bancoDeTeste()
      .from('apps')
      .select('id')
      .eq('store_id', lojaId)
      .single();
    const { count } = await bancoDeTeste()
      .from('app_configs')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', app?.id ?? '')
      .eq('status', 'published');
    return count;
  };

  // O visual rápido (C03) numa aba, e o editor noutra — que grava primeiro.
  const outra = await context.newPage();
  await outra.goto('/app');
  await outra.waitForLoadState('networkidle');
  const barraDaOutra = outra.getByRole('region', { name: 'Publicação do app' });
  const escolhaDaOutra = outra.getByRole('alertdialog', {
    name: 'O rascunho mudou em outro lugar',
  });
  await outra.getByRole('textbox', { name: 'Cor principal', exact: true }).fill('#be123c');
  await expect(barraDaOutra.getByText(/Rascunho salvo às/)).toBeVisible();

  // "Salvar e continuar" no C03 não grava por cima: nada muda, e a tela pede para recarregar.
  await page.getByRole('textbox', { name: 'Cor principal', exact: true }).fill('#1d4ed8');
  await page.getByRole('button', { name: 'Salvar e continuar' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'O rascunho do app mudou em outra aba' }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/lojas/${lojaId}/comecar$`));
  expect(await corNoBanco()).toBe('#be123c');
  await page.getByRole('button', { name: 'Recarregar a página' }).click();
  await expect(page.getByRole('textbox', { name: 'Cor principal', exact: true })).toHaveValue(
    '#be123c',
  );

  // Agora o editor nas duas abas; a primeira grava uma cor nova.
  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  const barra = page.getByRole('region', { name: 'Publicação do app' });
  const escolha = page.getByRole('alertdialog', { name: 'O rascunho mudou em outro lugar' });
  const cor = page.getByRole('textbox', { name: 'Cor principal', exact: true });
  await cor.fill('#15803d');
  await expect(barra.getByText(/Rascunho salvo às/)).toBeVisible();
  expect(await corNoBanco()).toBe('#15803d');

  // A outra ainda mostra a cor anterior: renomear uma aba lá NÃO grava por cima —
  // e a escolha diz o que mudou de cada lado.
  await outra.getByRole('button', { name: 'Abas' }).click();
  await outra.locator('#aba-busca-nome').fill('Procurar');
  await expect(escolhaDaOutra.getByText('Cor principal: #be123c → #15803d')).toBeVisible();
  await expect(escolhaDaOutra.getByText('Aba “Buscar” agora se chama “Procurar”')).toBeVisible();
  await varrer(outra, 'a escolha entre o rascunho de lá e o desta aba');
  expect(await corNoBanco()).toBe('#15803d');
  expect(await nomeNoBanco('busca')).toBe('Buscar');

  // Fechar a escolha não destrava nada: a barra diz que parou, e nada mais grava.
  await outra.keyboard.press('Escape');
  await expect(escolhaDaOutra).toHaveCount(0);
  await expect(
    barraDaOutra.getByText('O rascunho mudou em outro lugar, e esta aba parou de salvar.'),
  ).toBeVisible();
  await expect(barraDaOutra.getByRole('button', { name: /Publicar alterações/ })).toBeDisabled();
  await outra.locator('#aba-conta-nome').fill('Minha conta');
  await outra.waitForTimeout(2500);
  expect(await nomeNoBanco('busca')).toBe('Buscar');
  expect(await nomeNoBanco('conta')).toBe('Conta');

  // "Ficar com a desta aba" grava por cima: o que mudou lá (a cor) se perde, como a escolha avisa.
  await barraDaOutra.getByRole('button', { name: 'Resolver' }).click();
  await expect(escolhaDaOutra.getByText('Aba “Conta” agora se chama “Minha conta”')).toBeVisible();
  await escolhaDaOutra.getByRole('button', { name: 'Ficar com a desta aba' }).click();
  await expect(barraDaOutra.getByText(/Rascunho salvo às/)).toBeVisible();
  await expect.poll(() => nomeNoBanco('busca')).toBe('Procurar');
  expect(await nomeNoBanco('conta')).toBe('Minha conta');
  expect(await corNoBanco()).toBe('#be123c');

  // Agora a desatualizada é a primeira. "Ficar com a versão de lá" troca a tela
  // sem recarregar, e o que ela não tinha salvo fica para trás.
  await cor.fill('#7c3aed');
  await expect(escolha.getByText('Cor principal: #15803d → #7c3aed')).toBeVisible();
  await expect(escolha.getByText('Aba “Buscar” agora se chama “Procurar”')).toBeVisible();
  await escolha.getByRole('button', { name: 'Ficar com a versão de lá' }).click();
  await expect(page.getByText('Pronto: o editor mostra o rascunho mais novo.')).toBeVisible();
  await expect(cor).toHaveValue('#be123c');
  await page.getByRole('button', { name: 'Abas' }).click();
  await expect(page.locator('#aba-busca-nome')).toHaveValue('Procurar');
  expect(await corNoBanco()).toBe('#be123c');

  // E volta a gravar como sempre.
  await page.locator('#aba-inicio-nome').fill('Loja');
  await expect(barra.getByText(/Rascunho salvo às/)).toBeVisible();
  await expect.poll(() => nomeNoBanco('inicio')).toBe('Loja');
  expect(await nomeNoBanco('busca')).toBe('Procurar');

  // Publicar da aba que não viu a última mudança também para: o diálogo
  // listaria uma coisa, e iria ao ar outra.
  await barraDaOutra.getByRole('button', { name: /Publicar alterações/ }).click();
  await outra.getByRole('button', { name: 'Publicar agora' }).click();
  await expect(escolhaDaOutra.getByText('Aba “Início” agora se chama “Loja”')).toBeVisible();
  await expect(escolhaDaOutra.getByText('Nada: não há o que perder aqui.')).toBeVisible();
  await expect(escolhaDaOutra.getByRole('button', { name: 'Ficar com a desta aba' })).toHaveCount(
    0,
  );
  expect(await publicadas()).toBe(0);
  await escolhaDaOutra.getByRole('button', { name: 'Ficar com a versão de lá' }).click();
  await expect(outra.locator('#aba-inicio-nome')).toHaveValue('Loja');
  await barraDaOutra.getByRole('button', { name: /Publicar alterações/ }).click();
  await outra.getByRole('button', { name: 'Publicar agora' }).click();
  await expect(outra.getByText(/Versão \d+ publicada/)).toBeVisible();
  expect(await publicadas()).toBe(1);

  // Publicar lá não mudou o conteúdo: a primeira segue gravando, agora no rascunho novo.
  await page.getByRole('button', { name: 'Aparência' }).click();
  await cor.fill('#1d4ed8');
  await expect(barra.getByText(/Rascunho salvo às/)).toBeVisible();
  await expect(barra.getByText('1 mudança desde a versão no ar')).toBeVisible();
  expect(await corNoBanco()).toBe('#1d4ed8');

  // Restaurar da aba desatualizada também para: a comparação que ela mostrou
  // saiu do rascunho dela, e o de lá seria substituído sem ninguém ver.
  await outra.getByRole('button', { name: 'Versões' }).click();
  await outra
    .getByRole('listitem')
    .filter({ hasText: 'No ar' })
    .getByRole('button', { name: 'Restaurar', exact: true })
    .click();
  await outra.getByRole('alertdialog').getByRole('button', { name: 'Restaurar' }).click();
  await expect(escolhaDaOutra.getByText('Cor principal: #be123c → #1d4ed8')).toBeVisible();
  await expect(escolhaDaOutra.getByText('Nada: não há o que perder aqui.')).toBeVisible();
  await expect(outra.getByText(/carregada no rascunho/)).toHaveCount(0);
  expect(await corNoBanco()).toBe('#1d4ed8');

  // Sair do editor sem decidir, com uma mudança feita depois — que não grava:
  // a pessoa fica sabendo que o desta aba não foi salvo.
  await outra.keyboard.press('Escape');
  await expect(escolhaDaOutra).toHaveCount(0);
  await outra.getByRole('button', { name: 'Aparência' }).click();
  await outra.getByRole('textbox', { name: 'Cor principal', exact: true }).fill('#0f766e');
  await outra.waitForTimeout(2000);
  expect(await corNoBanco()).toBe('#1d4ed8');
  await outra
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('link', { name: 'Início' })
    .click();
  await outra.waitForURL((url) => url.pathname === '/');
  await expect(
    outra.getByText('As mudanças que você fez no app nesta aba não foram salvas', { exact: false }),
  ).toBeVisible();
  expect(await corNoBanco()).toBe('#1d4ed8');
  await outra.close();
});

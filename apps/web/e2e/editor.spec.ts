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

  // O diálogo de publicar diz, em frases, o que vai ao ar.
  await publicar.click();
  const aoPublicar = page.getByRole('alertdialog');
  await expect(aoPublicar.getByText('O que vai ao ar:')).toBeVisible();
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

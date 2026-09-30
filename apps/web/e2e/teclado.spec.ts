/**
 * Navegação por teclado — seção 10 do plano ("foco visível, navegação por
 * teclado").
 *
 * Quem não usa mouse (por escolha, por deficiência motora, com leitor de
 * tela) precisa chegar a tudo, ver onde está e não se perder: pular o
 * cabeçalho que se repete em toda tela, abrir e fechar menus, preencher e
 * enviar formulários, e confirmar uma exclusão com o foco voltando para onde
 * estava. Aqui cada passo é feito só com o teclado.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './base';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  criarLojaPelaTela,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
  tornarPlatformAdmin,
} from './apoio';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

/** Aperta Tab até o foco chegar ao alvo — ele TEM de ser alcançável pelo teclado. */
async function tabAte(page: Page, alvo: Locator, limite = 60): Promise<void> {
  for (let i = 0; i < limite; i += 1) {
    if (await alvo.evaluate((elemento) => elemento === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(alvo, `não se chega a ele com Tab em ${String(limite)} passos`).toBeFocused();
}

/** O que está com o foco se vê: um contorno ou um anel (sombra) em volta. */
async function focoVisivel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const elemento = document.activeElement;
    if (elemento === null || elemento === document.body) return 'ninguém com o foco';
    const estilo = getComputedStyle(elemento);
    const contorno = estilo.outlineStyle !== 'none' && estilo.outlineWidth !== '0px';
    const anel = estilo.boxShadow !== 'none';
    const nome = elemento.getAttribute('aria-label') ?? elemento.textContent.trim().slice(0, 40);
    return contorno || anel ? '' : `<${elemento.tagName.toLowerCase()}> ${nome}`;
  });
}

test('o painel só no teclado: pular o cabeçalho, foco à vista, menu, formulário e confirmação', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const email = emailDeTeste('teclado');
  await criarUsuarioConfirmado(email, 'Empresa Teclado');
  await entrar(page, email);
  await criarLojaPelaTela(page, 'Loja Teclado', 'loja-teclado.com.br');

  // O primeiro Tab é o "Pular para o conteúdo", que aparece com o foco e o leva ao conteúdo.
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Tab');
  const pular = page.getByRole('link', { name: 'Pular para o conteúdo' });
  await expect(pular).toBeFocused();
  await expect(pular).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#conteudo')).toBeFocused();

  // Cada parada do cabeçalho mostra onde o foco está.
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const semFoco: string[] = [];
  for (let parada = 0; parada < 14; parada += 1) {
    await page.keyboard.press('Tab');
    const problema = await focoVisivel(page);
    if (problema !== '') semFoco.push(problema);
  }
  expect(semFoco, 'foco que não se vê').toEqual([]);

  // O menu da conta: Enter abre, as setas andam, Esc fecha e o foco volta ao botão.
  const conta = page.getByRole('button', { name: 'Menu da conta' });
  await tabAte(page, conta);
  await page.keyboard.press('Enter');
  const itens = page.getByRole('menuitem');
  await expect(itens.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(itens.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(conta).toBeFocused();

  // Uma campanha escrita e salva só no teclado.
  await page.goto('/push/nova');
  await page.waitForLoadState('networkidle');
  const titulo = 'Campanha feita no teclado';
  await tabAte(page, page.getByLabel('Título', { exact: true }));
  await page.keyboard.type(titulo);
  await tabAte(page, page.getByLabel('Mensagem', { exact: true }));
  await page.keyboard.type('Escrita sem tocar no mouse.');
  await tabAte(page, page.getByRole('button', { name: 'Salvar como rascunho' }));
  await page.keyboard.press('Enter');
  await page.waitForURL('/push');
  await expect(page.getByText('Rascunho salvo.')).toBeVisible();

  // Excluir pede confirmação; o foco fica dentro dela, e Esc devolve o foco às ações.
  const acoes = page.getByRole('button', { name: `Ações de ${titulo}` });
  await tabAte(page, acoes);
  await page.keyboard.press('Enter');
  const excluir = page.getByRole('menuitem', { name: 'Excluir' });
  for (let i = 0; i < 5 && !(await excluir.evaluate((e) => e === document.activeElement)); i += 1) {
    await page.keyboard.press('ArrowDown');
  }
  await expect(excluir).toBeFocused();
  await page.keyboard.press('Enter');
  const confirmacao = page.getByRole('alertdialog');
  await expect(confirmacao).toContainText('Excluir a campanha?');
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    expect(
      await confirmacao.evaluate((dialogo) => dialogo.contains(document.activeElement)),
      'o foco saiu da confirmação',
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(confirmacao).toHaveCount(0);
  await expect(acoes).toBeFocused();
  // Nada foi excluído.
  await expect(page.getByRole('listitem').filter({ hasText: titulo })).toBeVisible();
});

test('o admin também começa pelo "Pular para o conteúdo"', async ({ page }) => {
  const email = emailDeTeste('teclado-equipe');
  await tornarPlatformAdmin(await criarUsuarioConfirmado(email, 'Equipe Storefy'));
  await entrar(page, email);

  await page.goto('/admin');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Tab');
  const pular = page.getByRole('link', { name: 'Pular para o conteúdo' });
  await expect(pular).toBeFocused();
  await expect(pular).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#conteudo')).toBeFocused();
});

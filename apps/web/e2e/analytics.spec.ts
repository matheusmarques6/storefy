/**
 * C11 — Analytics, de ponta a ponta.
 *
 * Os números da tela saem de um job (`/api/jobs/analytics`) que consolida o
 * que o app e a Shopify mandaram: o aparelho que o app registra (a instalação
 * e a abertura do dia) e o pedido que a Shopify avisa — do app, com a marca
 * que o app põe no carrinho, ou do site. Aqui cada peça entra pelo caminho de
 * verdade (o app assinado, o webhook assinado, o job com o segredo do cron), e
 * a tela é conferida número por número. Antes deste teste, nenhum e2e abria a
 * C11 com dado: os gráficos nunca tinham sido desenhados num teste.
 */
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './base';
import { MOTIVO_PULO, SUPABASE_DISPONIVEL, limparUsuariosDeTeste } from './apoio';
import { doApp, lojaComApp } from './app-assinado';
import { varrer } from './axe';
import { conectarShopify, webhookDoPedido } from './shopify-de-teste';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

/** O job do cron, chamado como a Vercel chama: com o segredo. */
async function rodarJobDosNumeros(page: Page): Promise<number> {
  return page.evaluate(async (segredo) => {
    const resposta = await fetch('/api/jobs/analytics', {
      headers: { authorization: `Bearer ${segredo}` },
    });
    return resposta.status;
  }, process.env.CRON_SECRET ?? '');
}

/**
 * O cartão de um número da C11: o `Card` mais próximo do rótulo, e só ele. O
 * primeiro, porque os números vêm antes dos gráficos — e o rótulo se repete na
 * legenda e na tabela do gráfico de uso.
 */
function cartao(page: Page, rotulo: string) {
  return page
    .getByText(rotulo, { exact: true })
    .first()
    .locator('xpath=ancestor::div[contains(concat(" ", @class, " "), " rounded-2xl ")][1]');
}

test('do app e da Shopify até os números, os gráficos e as tabelas deles', async ({ page }) => {
  test.setTimeout(90_000);
  const { lojaId, appId, segredo } = await lojaComApp(page, 'numeros');

  // Antes de qualquer uso: o estado vazio, sem número inventado.
  await page.goto('/analytics');
  await expect(page.getByText('Ainda não há números para mostrar')).toBeVisible();
  await expect(page.locator('.recharts-wrapper')).toHaveCount(0);

  // Dois aparelhos instalam o app, e um deles abre de novo: 2 instalações,
  // 2 ativos e 3 aberturas no dia.
  const [primeiro, segundo] = [randomUUID(), randomUUID()];
  for (const instalacao of [primeiro, segundo, primeiro]) {
    const registro = await doApp(page, segredo, '/api/public/devices', {
      appId,
      installId: instalacao,
      platform: 'android',
      appVersion: '1.0.0',
    });
    expect(registro.status, JSON.stringify(registro.corpo)).toBeLessThan(300);
  }

  // Três pedidos pelo webhook da Shopify: dois do app (R$ 200) e um do site (R$ 50).
  const dominio = `numeros-${randomUUID().slice(0, 8)}.myshopify.com`;
  await conectarShopify(lojaId, dominio);
  for (const pedido of [
    { id: 7001, total: '120.00' },
    { id: 7002, total: '80.00' },
    { id: 7003, total: '50.00', peloSite: true },
  ]) {
    const aviso = await webhookDoPedido(page, dominio, pedido);
    expect(aviso.status, JSON.stringify(aviso.corpo)).toBe(200);
  }

  // Sem o job, a tela ainda não sabe: os números são consolidados por ele.
  await page.reload();
  await expect(page.getByText('Ainda não há números para mostrar')).toBeVisible();
  expect(await rodarJobDosNumeros(page)).toBe(200);

  await page.reload();
  await expect(cartao(page, 'Receita pelo app')).toContainText(/R\$\s200,00/);
  await expect(cartao(page, 'Receita pelo app')).toContainText('2 pedidos no período.');
  await expect(cartao(page, 'Fatia do app')).toContainText('80');
  await expect(cartao(page, 'Fatia do app')).toContainText(/De R\$\s250,00 vendidos no total\./);
  await expect(cartao(page, 'Aparelhos ativos')).toContainText('2');
  await expect(cartao(page, 'Instalações')).toContainText('2');
  await expect(cartao(page, 'Instalações')).toContainText('3 aberturas do app no período.');

  // Os dois gráficos desenhados — e, para quem não vê o desenho, a tabela de cada um.
  await expect(page.locator('.recharts-wrapper')).toHaveCount(2);
  const abrirTabelas = page.getByText('Ver os números em tabela');
  await expect(abrirTabelas).toHaveCount(2);
  await abrirTabelas.nth(0).click();
  await abrirTabelas.nth(1).click();
  const receita = page.getByRole('table', { name: 'Receita por dia, pelo app e pelo site' });
  const hoje = receita.getByRole('row').filter({ hasText: /R\$\s200,00/ });
  await expect(hoje).toHaveCount(1);
  await expect(hoje).toContainText(/R\$\s50,00/);
  const uso = page.getByRole('table', { name: 'Aparelhos ativos e aberturas por dia' });
  await expect(
    uso.getByRole('row').filter({ has: page.getByRole('cell', { name: '3' }) }),
  ).toHaveCount(1);
  await varrer(page, '/analytics com números e as tabelas abertas');

  // O período muda na URL, e o dia de hoje continua dentro dele.
  await page.getByRole('link', { name: '7 dias' }).click();
  await page.waitForURL(/periodo=7/);
  await expect(cartao(page, 'Receita pelo app')).toContainText(/R\$\s200,00/);

  // Rodar o job de novo não soma nada: ele recalcula.
  expect(await rodarJobDosNumeros(page)).toBe(200);
  await page.reload();
  await expect(cartao(page, 'Receita pelo app')).toContainText(/R\$\s200,00/);
  await expect(cartao(page, 'Instalações')).toContainText('3 aberturas do app no período.');
});

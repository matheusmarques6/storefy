/**
 * A trava de `e2e/base.ts`, testada: sem isto, uma mudança nela que a
 * desligasse deixaria a suíte inteira verde sem vigiar nada.
 *
 * `test.fail()` marca o teste que TEM de falhar: o Playwright o roda e só o
 * aprova se ele de fato falhar — aqui, pela trava.
 */
import { test } from './base';

test('reprova o erro no console que o teste não declarou', async ({ page }) => {
  test.fail(true, 'a trava tem de reprovar este teste');
  await page.goto('/entrar');
  await page.evaluate(() => {
    console.error('erro de propósito');
  });
});

test('reprova a exceção sem tratamento na página', async ({ page }) => {
  test.fail(true, 'a trava tem de reprovar este teste');
  await page.goto('/entrar');
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('exceção de propósito');
    }, 0);
  });
  await page.waitForTimeout(200);
});

test('vigia também a página de um contexto que o teste cria', async ({ browser }) => {
  test.fail(true, 'a trava tem de reprovar este teste');
  const contexto = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const pagina = await contexto.newPage();
  await pagina.goto('/entrar');
  await pagina.evaluate(() => {
    console.error('erro de propósito em outro contexto');
  });
  await contexto.close();
});

test('aprova o erro que o teste declarou, e a resposta 404 não conta', async ({
  page,
  errosDoConsole,
}) => {
  errosDoConsole.esperar(/erro de propósito/);
  await page.goto('/entrar');
  await page.evaluate(() => {
    console.error('erro de propósito');
  });
  // O navegador registra "Failed to load resource" para a 404: é resposta, não código.
  await page.goto('/uma-pagina-que-nao-existe');
});

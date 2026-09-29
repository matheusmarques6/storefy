/**
 * O segredo do app, da rota do build ao aparelho registrado.
 *
 * Este teste nasceu de um defeito: nada criava o segredo. Todo build saía com
 * `deviceSecret` nulo, e o app, sem com que assinar, não registrava o
 * aparelho nem mandava evento — push, automações e números paravam na origem,
 * sem erro em lugar nenhum. Aqui a cadeia roda inteira: o workflow pede os
 * dados do build, recebe o segredo, e uma chamada assinada com ele registra o
 * aparelho, como o app faria.
 */
import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
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

const SEGREDO_DO_WORKFLOW = process.env.BUILD_API_SECRET ?? '';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.skip(SEGREDO_DO_WORKFLOW === '', 'Defina BUILD_API_SECRET, como o scripts/e2e-local.sh faz.');
test.afterAll(limparUsuariosDeTeste);

interface Resposta {
  status: number;
  corpo: Record<string, unknown>;
}

/**
 * Do navegador, na mesma origem: o `app.localhost` do teste só resolve no
 * Chromium, e não no processo do Playwright.
 */
function postar(
  page: Page,
  caminho: string,
  corpo: string,
  cabecalhos: Record<string, string>,
): Promise<Resposta> {
  return page.evaluate(
    async ({ caminhoUsado, corpoEnviado, cabecalhosEnviados }) => {
      const resposta = await fetch(caminhoUsado, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cabecalhosEnviados },
        body: corpoEnviado,
      });
      const texto = await resposta.text();
      return {
        status: resposta.status,
        corpo: (texto === '' ? {} : JSON.parse(texto)) as Record<string, unknown>,
      };
    },
    { caminhoUsado: caminho, corpoEnviado: corpo, cabecalhosEnviados: cabecalhos },
  );
}

/** A assinatura que o app calcula (`t=...,v1=...`), escrita aqui do zero. */
function assinatura(segredo: string, corpo: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', segredo)
    .update(`${String(t)}.${corpo}`)
    .digest('hex');
  return `t=${String(t)},v1=${v1}`;
}

test('o build recebe o segredo do app, e o aparelho assinado com ele se registra', async ({
  page,
}) => {
  const email = emailDeTeste('segredo');
  const usuario = await criarUsuarioConfirmado(email, 'Empresa Segredo');
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, 'Loja Segredo', 'loja-segredo.com.br');

  // O build leva a config NO AR: publica pela tela, como o lojista.
  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByRole('button', { name: 'Publicar agora' }).click();
  await expect(page.getByText(/Versão \d+ publicada/)).toBeVisible();

  const { data: app } = await bancoDeTeste()
    .from('apps')
    .select('id, device_secret_enc')
    .eq('store_id', lojaId)
    .single();
  if (app == null) throw new Error('A loja criada pela tela ficou sem app.');
  expect(app.device_secret_enc).toBeNull();

  /*
   * O pedido de build vai para o GitHub, que não existe no teste: a linha na
   * fila nasce aqui, como a tela de publicação a criaria antes do disparo.
   */
  const pedirBuild = async (plataforma: 'android' | 'ios'): Promise<string> => {
    const { data: build, error } = await bancoDeTeste()
      .from('builds')
      .insert({ app_id: app.id, platform: plataforma, status: 'queued', triggered_by: usuario })
      .select('id')
      .single();
    if (error != null) throw new Error(error.message);
    return build.id;
  };

  const doWorkflow = { Authorization: `Bearer ${SEGREDO_DO_WORKFLOW}` };
  const primeiro = await postar(
    page,
    '/api/internal/build',
    JSON.stringify({ buildId: await pedirBuild('android') }),
    doWorkflow,
  );
  expect(primeiro.status).toBe(200);
  const segredo = String(primeiro.corpo.deviceSecret);
  expect(segredo).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // No banco, só cifrado.
  const { data: depois } = await bancoDeTeste()
    .from('apps')
    .select('device_secret_enc')
    .eq('id', app.id)
    .single();
  expect(depois?.device_secret_enc).toBeTruthy();
  expect(depois?.device_secret_enc).not.toContain(segredo);

  // O app instalado registra o aparelho, assinando com o segredo do build.
  const corpo = JSON.stringify({
    appId: app.id,
    subscriptionId: 'inscricao-do-e2e-do-segredo',
    platform: 'android',
    appVersion: '1.0.1',
  });
  const registro = await postar(page, '/api/public/devices', corpo, {
    'x-storefy-signature': assinatura(segredo, corpo),
  });
  expect(registro.status, JSON.stringify(registro.corpo)).toBeLessThan(300);

  const { data: aparelhos } = await bancoDeTeste()
    .from('devices')
    .select('onesignal_subscription_id, platform, app_version')
    .eq('app_id', app.id);
  expect(aparelhos).toEqual([
    {
      onesignal_subscription_id: 'inscricao-do-e2e-do-segredo',
      platform: 'android',
      app_version: '1.0.1',
    },
  ]);

  // Assinado com outro segredo, recusa — e não registra nada.
  const falsa = JSON.stringify({
    appId: app.id,
    subscriptionId: 'inscricao-falsificada',
    platform: 'ios',
  });
  const recusada = await postar(page, '/api/public/devices', falsa, {
    'x-storefy-signature': assinatura('um-segredo-qualquer', falsa),
  });
  expect(recusada.status).toBeGreaterThanOrEqual(400);

  // O build da outra plataforma leva o MESMO segredo: os dois apps assinam igual.
  const segundo = await postar(
    page,
    '/api/internal/build',
    JSON.stringify({ buildId: await pedirBuild('ios') }),
    doWorkflow,
  );
  expect(segundo.status).toBe(200);
  expect(segundo.corpo.deviceSecret).toBe(segredo);

  // Sem o segredo do workflow, a rota não entrega nada.
  const semSegredo = await postar(
    page,
    '/api/internal/build',
    JSON.stringify({ buildId: await pedirBuild('android') }),
    { Authorization: 'Bearer outro-segredo' },
  );
  expect(semSegredo.status).toBe(401);
  expect(JSON.stringify(semSegredo.corpo)).not.toContain(segredo);
});

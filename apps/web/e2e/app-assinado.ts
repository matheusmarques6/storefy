/**
 * O app instalado, fingido pelo teste: chamadas assinadas com o segredo que o
 * build entrega, como o app faria (`apps/mobile/src/push/api.ts`).
 *
 * Mora aqui porque mais de um teste precisa de uma loja com o app "no ar":
 * config publicada pela tela, o segredo pedido pela rota do build e o
 * aparelho registrado pela rota pública.
 */
import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import {
  bancoDeTeste,
  criarLojaPelaTela,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
} from './apoio';

export const SEGREDO_DO_WORKFLOW = process.env.BUILD_API_SECRET ?? '';

export interface Resposta {
  status: number;
  corpo: Record<string, unknown>;
}

/** Do navegador, na mesma origem: o `app.localhost` do teste só resolve no Chromium. */
export function postar(
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

/** A assinatura que o app calcula (`t=...,v1=...`). */
export function assinatura(segredo: string, corpo: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', segredo)
    .update(`${String(t)}.${corpo}`)
    .digest('hex');
  return `t=${String(t)},v1=${v1}`;
}

/** Uma chamada do app instalado: assinada com o segredo que o build entregou. */
export function doApp(
  page: Page,
  segredo: string,
  caminho: string,
  dados: Record<string, unknown>,
): Promise<Resposta> {
  const corpo = JSON.stringify(dados);
  return postar(page, caminho, corpo, { 'x-storefy-signature': assinatura(segredo, corpo) });
}

/**
 * Uma loja com a config no ar e o segredo do app, como o build a deixaria.
 * O segredo é o que o app usa para assinar o registro, o pareamento e o toque.
 */
export async function lojaComApp(page: Page, rotulo: string) {
  const email = emailDeTeste(rotulo);
  const usuario = await criarUsuarioConfirmado(email, `Empresa ${rotulo}`);
  await entrar(page, email);
  const lojaId = await criarLojaPelaTela(page, `Loja ${rotulo}`, `loja-${rotulo}.com.br`);

  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /Publicar alterações/ }).click();
  await page.getByRole('button', { name: 'Publicar agora' }).click();
  await expect(page.getByText(/Versão \d+ publicada/)).toBeVisible();

  const { data: app } = await bancoDeTeste()
    .from('apps')
    .select('id')
    .eq('store_id', lojaId)
    .single();
  if (app == null) throw new Error('A loja criada pela tela ficou sem app.');

  const { data: build, error } = await bancoDeTeste()
    .from('builds')
    .insert({ app_id: app.id, platform: 'android', status: 'queued', triggered_by: usuario })
    .select('id')
    .single();
  if (error != null) throw new Error(error.message);

  const resposta = await postar(
    page,
    '/api/internal/build',
    JSON.stringify({ buildId: build.id }),
    {
      Authorization: `Bearer ${SEGREDO_DO_WORKFLOW}`,
    },
  );
  expect(resposta.status).toBe(200);
  return { usuario, lojaId, appId: app.id, segredo: String(resposta.corpo.deviceSecret) };
}

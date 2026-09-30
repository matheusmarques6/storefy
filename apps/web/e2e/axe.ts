/**
 * O axe-core — o motor das auditorias de acessibilidade do Chrome — numa tela
 * aberta pelo Playwright: nenhuma violação das regras WCAG 2.1 nível A e AA.
 *
 * A prévia da loja (o iframe do editor) fica de fora: é o site do lojista, e
 * não uma tela da Storefy.
 */
import { createRequire } from 'node:module';
import type { AxeResults, RunOptions } from 'axe-core';
import { expect, type Page } from '@playwright/test';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const OPCOES: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
};

/** Roda o axe na tela que chegou (o esqueleto não conta) e anota cada violação. */
export async function varrer(page: Page, tela: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Carregando…', { exact: true })).toHaveCount(0);
  await page.addScriptTag({ path: AXE });
  const violacoes = await page.evaluate(async (opcoes) => {
    const axe = (window as unknown as { axe: { run: (...args: unknown[]) => Promise<AxeResults> } })
      .axe;
    const resultado = await axe.run({ exclude: [['iframe']] }, opcoes);
    return resultado.violations.map((violacao) => ({
      regra: violacao.id,
      impacto: violacao.impact ?? '',
      ajuda: violacao.help,
      onde: violacao.nodes
        .slice(0, 5)
        .map((no) => `${no.target.join(' ')} → ${no.failureSummary?.split('\n')[1]?.trim() ?? ''}`),
    }));
  }, OPCOES);
  // Suave: uma tela com problema não esconde as outras, e o relatório lista todas.
  expect
    .soft(
      violacoes.map((violacao) => violacao.regra),
      `${tela}:\n${violacoes
        .map(
          (v) =>
            `  [${v.impacto}] ${v.regra}: ${v.ajuda}\n${v.onde.map((o) => `    ${o}`).join('\n')}`,
        )
        .join('\n')}`,
    )
    .toEqual([]);
}

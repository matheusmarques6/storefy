/**
 * Acessibilidade — seção 10 do plano ("contraste AA, foco visível, navegação
 * por teclado") e regra 3 (toda tela completa).
 *
 * O axe-core — o mesmo motor das auditorias de acessibilidade do Chrome — em
 * cada tela do painel, das de fora dele e do admin, com dado de verdade criado
 * pela tela: nenhuma violação das regras WCAG 2.1 nível A e AA. O que ele
 * pega é o que um leitor de tela tropeça e o que um olho cansado não lê:
 * campo sem nome, botão só com ícone e sem rótulo, contraste abaixo de 4,5:1,
 * lista montada errado, id repetido.
 *
 * A prévia da loja (o iframe do editor) fica de fora: é o site do lojista, e
 * não uma tela da Storefy.
 */
import { createRequire } from 'node:module';
import type { AxeResults, RunOptions } from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  abrirChamadoPelaTela,
  bancoDeTeste,
  criarLojaPelaTela,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
  tornarPlatformAdmin,
} from './apoio';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const OPCOES: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
};

/** Roda o axe na tela que chegou (o esqueleto não conta) e anota cada violação. */
async function varrer(page: Page, tela: string): Promise<void> {
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

async function abrirEVarrer(page: Page, caminho: string): Promise<void> {
  await page.goto(caminho);
  await varrer(page, caminho);
}

test('o painel do lojista, tela por tela, sem violação de acessibilidade', async ({ page }) => {
  test.setTimeout(240_000);
  const email = emailDeTeste('a11y');
  await criarUsuarioConfirmado(email, 'Empresa Acessível');
  await entrar(page, email);

  // O menu da conta e o seletor de loja, abertos.
  await abrirEVarrer(page, '/lojas/nova');
  await page.getByRole('button', { name: 'Menu da conta' }).click();
  await varrer(page, 'o menu da conta aberto');
  await page.keyboard.press('Escape');
  const lojaId = await criarLojaPelaTela(page, 'Loja Acessível', 'loja-acessivel.com.br');
  await varrer(page, 'C03 — o visual do app');
  await abrirEVarrer(page, `/lojas/${lojaId}/comecar/pronto`);

  // Uma campanha escrita no composer (C08), e o detalhe e a edição dela.
  await abrirEVarrer(page, '/push/nova');
  const titulo = 'Liquidação de primavera em toda a loja';
  await page.getByLabel('Título', { exact: true }).fill(titulo);
  await page.getByLabel('Mensagem', { exact: true }).fill('Só neste fim de semana.');
  await page.getByRole('button', { name: 'Salvar como rascunho' }).click();
  await page.waitForURL('/push');
  // O aviso do canto fala português com o leitor de tela, e não "Close toast".
  await expect(page.getByText('Rascunho salvo.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fechar aviso' })).toBeVisible();
  await expect(page.getByRole('region', { name: /^Avisos/ })).toBeAttached();
  await varrer(page, '/push (C07 com a campanha)');

  // O menu de ações aberto, e a confirmação de excluir (que volta sem excluir).
  const linha = page.getByRole('listitem').filter({ hasText: titulo });
  await linha.getByRole('button', { name: `Ações de ${titulo}` }).click();
  await varrer(page, '/push (menu de ações aberto)');
  await page.getByRole('menuitem', { name: 'Excluir' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Excluir a campanha?');
  await varrer(page, '/push (confirmação de excluir)');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Voltar' }).click();

  // Os erros do formulário na tela, cada um ligado ao seu campo.
  await abrirEVarrer(page, '/push/nova');
  await page.getByRole('button', { name: 'Salvar como rascunho' }).click();
  await expect(page.getByText(/título/i).first()).toBeVisible();
  await varrer(page, '/push/nova (com os erros)');
  const { data: campanha } = await bancoDeTeste()
    .from('push_campaigns')
    .select('id')
    .eq('title', titulo)
    .single();
  if (campanha == null) throw new Error('A campanha do teste não foi gravada.');
  await abrirEVarrer(page, `/push/${campanha.id}`);
  await abrirEVarrer(page, `/push/${campanha.id}/editar`);

  // Uma automação ligada, e o detalhe dela (C09 e C10).
  await abrirEVarrer(page, '/push/automacoes');
  const boasVindas = page.getByRole('region', { name: 'Boas-vindas', exact: true });
  await boasVindas.getByRole('switch', { name: 'Ligar Boas-vindas' }).click();
  await expect(page.getByText('Automação “Boas-vindas” ligada.')).toBeVisible();
  await boasVindas.getByRole('button', { name: 'Editar mensagem' }).click();
  await varrer(page, '/push/automacoes (editando a mensagem)');
  await boasVindas.getByRole('link', { name: 'Ver detalhes' }).click();
  await page.waitForURL(/\/push\/automacoes\/[0-9a-f-]{36}$/);
  await varrer(page, 'o detalhe da automação');

  // Um chamado aberto pela Ajuda, e um guia (C17).
  await abrirChamadoPelaTela(page, 'O app foi recusado pela Apple');
  await varrer(page, 'o chamado');
  await abrirEVarrer(page, '/ajuda');
  await abrirEVarrer(page, '/ajuda/primeiros-passos');

  // O editor (C06), seção por seção.
  await abrirEVarrer(page, '/app');
  const secoes = page.getByRole('navigation', { name: 'Seções do editor' });
  for (const secao of ['Abas', 'Loja', 'Recursos', 'Versões']) {
    await secoes.getByRole('button', { name: secao, exact: true }).click();
    await varrer(page, `/app › ${secao}`);
  }

  for (const caminho of [
    '/',
    '/lojas',
    `/lojas/${lojaId}`,
    `/lojas/${lojaId}/comecar`,
    '/analytics',
    '/publicacao',
    '/publicacao/contas',
    '/integracoes',
    '/configuracoes',
    '/configuracoes/equipe',
    '/configuracoes/conta',
    '/configuracoes/plano',
    `/privacy/${lojaId}`,
  ]) {
    await abrirEVarrer(page, caminho);
  }
});

test('as telas de fora do painel, sem violação de acessibilidade', async ({ page }) => {
  for (const caminho of [
    '/entrar',
    '/entrar?aviso=sessao-encerrada',
    '/cadastrar',
    '/recuperar-senha',
    '/confirmar-email?email=pessoa%40exemplo.test',
    '/convite/um-convite-que-nao-existe',
    '/status',
    '/admin/entrar',
    '/uma-pagina-que-nao-existe',
  ]) {
    await abrirEVarrer(page, caminho);
  }
});

test('o admin, tela por tela, sem violação de acessibilidade', async ({ page }) => {
  test.setTimeout(180_000);
  const emailCliente = emailDeTeste('a11y-cliente');
  await criarUsuarioConfirmado(emailCliente, 'Empresa Cliente Acessível');
  await entrar(page, emailCliente);
  const lojaId = await criarLojaPelaTela(page, 'Loja Cliente', 'loja-cliente-a11y.com.br');
  const chamadoId = await abrirChamadoPelaTela(page, 'Não consigo publicar na Google Play');
  const { data: loja } = await bancoDeTeste()
    .from('stores')
    .select('org_id')
    .eq('id', lojaId)
    .single();
  if (loja == null) throw new Error('A loja do teste não foi gravada.');
  await page.context().clearCookies();

  const emailEquipe = emailDeTeste('a11y-equipe');
  await tornarPlatformAdmin(await criarUsuarioConfirmado(emailEquipe, 'Equipe Storefy'));
  await entrar(page, emailEquipe);

  for (const caminho of [
    '/admin',
    '/admin/organizacoes',
    `/admin/organizacoes/${loja.org_id}`,
    '/admin/lojas',
    '/admin/builds',
    '/admin/revisoes',
    '/admin/contas',
    '/admin/push',
    '/admin/ota',
    '/admin/planos',
    '/admin/presets',
    '/admin/equipe',
    '/admin/logs',
    '/admin/sistema',
    '/admin/chamados',
    `/admin/chamados/${chamadoId}`,
  ]) {
    await abrirEVarrer(page, caminho);
  }
});

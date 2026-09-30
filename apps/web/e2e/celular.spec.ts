/**
 * O painel no celular: a seção 10 do plano ("o painel precisa funcionar no
 * celular, pelo menos para dashboard, campanhas e analytics") e a regra 3
 * (responsividade em toda tela).
 *
 * A página que rola para o lado é o defeito que ninguém vê no computador. No
 * celular, a tela inteira desliza sob o dedo, o menu da conta sai da vista e o
 * lojista acha que o painel quebrou. Já aconteceu uma vez — a navegação que
 * deixou de caber (ver `navegacao.tsx`) — e só foi achada medindo. Aqui cada
 * tela abre a 390px, a largura de um iPhone comum, com dado de verdade criado
 * pela própria tela, e nenhuma pode ser mais larga que o celular.
 *
 * O dado é comprido de propósito: nome de loja longo e endereço sem espaço, o
 * que mais empurra uma tela para o lado, porque não quebra sozinho.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './base';
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

/** O plano que a A09 cria no teste do admin. */
const PLANO = `Crescimento Plus Anual ${Math.random().toString(36).slice(2, 6)}`;

test.afterAll(async () => {
  await limparUsuariosDeTeste();
  // Planos são da plataforma, e não de uma empresa: saem aqui, com a trilha.
  const banco = bancoDeTeste();
  const { data: planos } = await banco.from('plans').select('id').eq('nome', PLANO);
  const ids = (planos ?? []).map((plano) => plano.id);
  if (ids.length > 0) {
    await banco.from('plans').delete().in('id', ids);
    await banco.from('audit_logs').delete().eq('entity', 'plans').in('entity_id', ids);
  }
});

test.use({ viewport: { width: 390, height: 844 } });

const NOME_DA_LOJA = 'Moda Feminina Primavera e Verão das Irmãs Albuquerque';

function enderecoDaLoja(): string {
  return `modafemininaprimaveraeveraodasirmas${Math.random().toString(36).slice(2, 8)}.com.br`;
}

/**
 * O quanto a página passa da largura da tela, e quem passa: os elementos mais
 * fundos que saem pela direita e os textos que furam a própria caixa (a
 * palavra sem ponto de quebra sai do parágrafo sem mexer na caixa dele), para
 * o erro apontar o culpado.
 */
async function transbordo(page: Page): Promise<{ sobra: number; culpados: string[] }> {
  return page.evaluate(() => {
    const largura = document.documentElement.clientWidth;
    const sobra = document.documentElement.scrollWidth - largura;
    const culpados: string[] = [];
    if (sobra <= 0) return { sobra, culpados };

    const descrever = (elemento: Element, texto: string) => {
      const classe = typeof elemento.className === 'string' ? elemento.className : '';
      return `<${elemento.tagName.toLowerCase()} class="${classe.slice(0, 100)}"> ${texto.trim().slice(0, 60)}`;
    };
    const passa = (elemento: Element) => {
      const caixa = elemento.getBoundingClientRect();
      return caixa.width > 0 && caixa.right > largura + 1;
    };
    for (const elemento of Array.from(document.body.querySelectorAll('*'))) {
      if (!passa(elemento)) continue;
      // Só o mais fundo: o pai de um culpado não diz nada de novo.
      if (Array.from(elemento.children).some(passa)) continue;
      culpados.push(descrever(elemento, elemento.textContent));
      if (culpados.length === 6) return { sobra, culpados };
    }
    const textos = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const trecho = document.createRange();
    for (let no = textos.nextNode(); no !== null; no = textos.nextNode()) {
      trecho.selectNodeContents(no);
      const caixa = trecho.getBoundingClientRect();
      if (caixa.width === 0 || caixa.right <= largura + 1 || no.parentElement === null) continue;
      // O texto cortado pela caixa (o `truncate`) ou que rola dentro dela não empurra a página.
      let cortado = false;
      for (
        let acima: Element | null = no.parentElement;
        acima !== null;
        acima = acima.parentElement
      ) {
        if (getComputedStyle(acima).overflowX !== 'visible') {
          cortado = true;
          break;
        }
      }
      if (cortado) continue;
      culpados.push(`texto em ${descrever(no.parentElement, no.textContent ?? '')}`);
      if (culpados.length === 6) break;
    }
    return { sobra, culpados };
  });
}

/** Espera a tela que chegou (o esqueleto não conta) e mede. */
async function conferirLargura(page: Page, tela: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Carregando…', { exact: true })).toHaveCount(0);
  const { sobra, culpados } = await transbordo(page);
  // Suave: uma tela que transborda não esconde as outras, e o relatório lista todas.
  expect
    .soft(sobra, `${tela} passa ${String(sobra)}px da largura do celular:\n${culpados.join('\n')}`)
    .toBeLessThanOrEqual(0);
}

async function medir(page: Page, caminho: string): Promise<void> {
  await page.goto(caminho);
  await conferirLargura(page, caminho);
}

test('o painel do lojista cabe no celular, tela por tela, e o menu leva a cada seção', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const email = emailDeTeste('celular');
  await criarUsuarioConfirmado(email, 'Irmãs Albuquerque Comércio de Roupas e Acessórios Ltda');
  await entrar(page, email);

  // O começo (C02 a C04), no celular.
  await medir(page, '/lojas/nova');
  const lojaId = await criarLojaPelaTela(page, NOME_DA_LOJA, enderecoDaLoja());
  await conferirLargura(page, 'C03 — o visual do app');
  await medir(page, `/lojas/${lojaId}/comecar/pronto`);

  // No celular, as seções ficam no menu: é por ele que se chega a cada uma.
  await medir(page, '/');
  await page.getByRole('button', { name: 'Abrir o menu de seções' }).click();
  await page.getByRole('menuitem', { name: 'Analytics' }).click();
  await page.waitForURL('/analytics');
  await conferirLargura(page, '/analytics');
  // E o menu da conta — onde fica o "Sair" — continua na tela.
  await expect(page.getByRole('button', { name: 'Menu da conta' })).toBeInViewport();

  // Uma campanha de verdade, escrita no composer do celular (C08).
  await medir(page, '/push/nova');
  const titulo = 'Liquidação de primavera: até 50% em vestidos, saias e acessórios';
  await page.getByLabel('Título', { exact: true }).fill(titulo);
  await page
    .getByLabel('Mensagem', { exact: true })
    .fill('Só neste fim de semana, com frete grátis para todo o Brasil acima de R$ 199.');
  await page.getByRole('button', { name: 'Salvar como rascunho' }).click();
  await page.waitForURL('/push');
  await expect(page.getByText('Rascunho salvo.')).toBeVisible();
  await conferirLargura(page, '/push (C07 com a campanha)');
  const { data: campanha } = await bancoDeTeste()
    .from('push_campaigns')
    .select('id')
    .eq('title', titulo)
    .single();
  if (campanha == null) throw new Error('A campanha do teste não foi gravada.');
  await medir(page, `/push/${campanha.id}`);
  await medir(page, `/push/${campanha.id}/editar`);

  // Uma automação ligada pela chave do card, e o detalhe dela (C09 e C10).
  await medir(page, '/push/automacoes');
  const boasVindas = page.getByRole('region', { name: 'Boas-vindas', exact: true });
  await boasVindas.getByRole('switch', { name: 'Ligar Boas-vindas' }).click();
  await expect(page.getByText('Automação “Boas-vindas” ligada.')).toBeVisible();
  await conferirLargura(page, '/push/automacoes (com a automação ligada)');
  await boasVindas.getByRole('link', { name: 'Ver detalhes' }).click();
  await page.waitForURL(/\/push\/automacoes\/[0-9a-f-]{36}$/);
  await conferirLargura(page, 'o detalhe da automação');

  // Um chamado aberto pela Ajuda, a conversa dele e um guia (C17).
  await abrirChamadoPelaTela(
    page,
    'O app foi recusado pela Apple por causa da política de privacidade',
  );
  await conferirLargura(page, 'o chamado');
  await medir(page, '/ajuda');
  await page.getByRole('link', { name: /Primeiros passos/ }).click();
  await page.waitForURL('/ajuda/primeiros-passos');
  await conferirLargura(page, '/ajuda/primeiros-passos');

  // O editor (C06), seção por seção: cada uma desenha o próprio painel.
  await medir(page, '/app');
  const secoes = page.getByRole('navigation', { name: 'Seções do editor' });
  for (const secao of ['Aparência', 'Abas', 'Loja', 'Recursos', 'Versões']) {
    await secoes.getByRole('button', { name: secao, exact: true }).click();
    await conferirLargura(page, `/app › ${secao}`);
  }
  // E a prévia em cada vista: a loja, o ícone, a abertura e as boas-vindas.
  const vistas = page.getByRole('group', { name: 'O que ver na prévia' }).getByRole('button');
  for (const vista of await vistas.all()) {
    const nome = (await vista.textContent()) ?? '';
    await vista.click();
    await conferirLargura(page, `/app › prévia › ${nome}`);
  }

  // O resto, cada tela com a loja e os dados acima.
  for (const caminho of [
    '/',
    '/lojas',
    `/lojas/${lojaId}`,
    `/lojas/${lojaId}/comecar`,
    '/publicacao',
    '/publicacao/contas',
    '/integracoes',
    '/configuracoes',
    '/configuracoes/equipe',
    '/configuracoes/conta',
    '/configuracoes/plano',
    `/privacy/${lojaId}`,
  ]) {
    await medir(page, caminho);
  }
});

test('as telas de fora do painel cabem no celular', async ({ page }) => {
  for (const caminho of [
    '/entrar',
    '/cadastrar',
    '/recuperar-senha',
    '/confirmar-email?email=irmas.albuquerque.comercio.de.roupas%40exemplo.test',
    '/convite/um-convite-que-nao-existe',
    '/status',
    '/admin/entrar',
  ]) {
    await medir(page, caminho);
  }
});

test('o admin cabe no celular, com um cliente de verdade para mostrar', async ({ page }) => {
  test.setTimeout(180_000);
  // O cliente: loja e chamado, pela tela, para as listas terem o que mostrar.
  const emailCliente = emailDeTeste('celular-cliente');
  await criarUsuarioConfirmado(emailCliente, 'Irmãs Albuquerque Comércio de Roupas e Acessórios');
  await entrar(page, emailCliente);
  const lojaId = await criarLojaPelaTela(page, NOME_DA_LOJA, enderecoDaLoja());
  const chamadoId = await abrirChamadoPelaTela(page, 'Não consigo publicar o app na Google Play');
  const { data: loja } = await bancoDeTeste()
    .from('stores')
    .select('org_id')
    .eq('id', lojaId)
    .single();
  if (loja == null) throw new Error('A loja do teste não foi gravada.');
  await page.context().clearCookies();

  const emailEquipe = emailDeTeste('celular-equipe');
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
    await medir(page, caminho);
  }

  // Um plano criado pela A09 no celular, e o detalhe dele.
  await page.goto('/admin/planos');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Nome', { exact: true }).fill(PLANO);
  await page.getByLabel('Preço por mês (R$)').fill('199,90');
  await page.getByRole('button', { name: 'Criar plano' }).click();
  await expect(page.getByText(`Plano ${PLANO} criado.`)).toBeVisible();
  await conferirLargura(page, '/admin/planos (com o plano)');
  const linha = page.getByRole('row').filter({ hasText: PLANO });
  await linha.getByRole('link', { name: 'Editar' }).click();
  await page.waitForURL(/\/admin\/planos\/[^/]+$/);
  await conferirLargura(page, 'o detalhe do plano');
});

/**
 * Os cabeçalhos de segurança no navegador (seção 8 do plano).
 *
 * O teste de unidade confere a configuração; este confere o que o Next
 * entrega de verdade — no painel com sessão, nas telas de fora, no admin, na
 * página que não existe, na API e no arquivo estático — e o efeito que
 * importa: um site de fora não consegue pôr o painel dentro de um iframe. A
 * prévia da loja, que o próprio painel enquadra, continua com as regras dela.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
} from './apoio';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

const ESPERADOS: Record<string, string> = {
  'content-security-policy': "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
  'x-frame-options': 'SAMEORIGIN',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
};

/**
 * Os cabeçalhos de uma resposta, pedida pela própria página (mesma origem).
 * Da rede, e não do cache: o Chromium tira o HSTS da cópia que guarda.
 */
async function cabecalhosDe(page: Page, caminho: string): Promise<Record<string, string>> {
  return page.evaluate(async (endereco) => {
    const resposta = await fetch(endereco, { redirect: 'manual', cache: 'no-store' });
    return Object.fromEntries(resposta.headers.entries());
  }, caminho);
}

function conferir(cabecalhos: Record<string, string>, onde: string): void {
  for (const [chave, valor] of Object.entries(ESPERADOS)) {
    expect(cabecalhos[chave], `${chave} em ${onde}`).toBe(valor);
  }
}

test('toda resposta leva os cabeçalhos: telas, admin, erro, API e arquivo estático', async ({
  page,
}) => {
  const avisos: string[] = [];
  page.on('console', (mensagem) => {
    if (/Permissions-Policy|Content Security Policy|X-Frame-Options/i.test(mensagem.text())) {
      avisos.push(mensagem.text());
    }
  });

  for (const caminho of [
    '/entrar',
    '/cadastrar',
    '/admin/entrar',
    '/status',
    '/uma-pagina-que-nao-existe',
  ]) {
    const resposta = await page.goto(caminho);
    if (resposta === null) throw new Error(`Sem resposta em ${caminho}`);
    conferir(resposta.headers(), caminho);
  }

  // A API e o JavaScript do próprio Next também.
  conferir(await cabecalhosDe(page, '/api/health'), '/api/health');
  const script = await page.locator('script[src*="/_next/static/"]').first().getAttribute('src');
  if (script === null) throw new Error('A página não carregou nenhum script do Next.');
  conferir(await cabecalhosDe(page, script), script);

  // Nenhum cabeçalho confunde o navegador: nada de aviso no console.
  expect(avisos).toEqual([]);
});

test('o painel com sessão também, e a prévia da loja fica com as regras dela', async ({ page }) => {
  const email = emailDeTeste('cabecalhos');
  await criarUsuarioConfirmado(email, 'Empresa Cabeçalhos');
  await entrar(page, email);

  const resposta = await page.goto('/lojas/nova');
  if (resposta === null) throw new Error('Sem resposta no painel.');
  conferir(resposta.headers(), '/lojas/nova');

  // A prévia é o HTML da loja, com um <base> apontando para ela: a política
  // do painel (`base-uri 'self'`) a quebraria, e ela não a recebe.
  const previa = await cabecalhosDe(page, '/api/preview-proxy');
  expect(previa['content-security-policy'] ?? '').not.toContain('base-uri');
  expect(previa['x-frame-options']).toBeUndefined();
});

test('um site de fora não consegue pôr o painel nem o admin dentro de um iframe', async ({
  page,
}) => {
  const origem = test.info().project.use.baseURL ?? 'http://app.localhost:3000';
  const recusas: string[] = [];
  page.on('console', (mensagem) => {
    if (mensagem.text().includes('frame-ancestors')) recusas.push(mensagem.text());
  });

  // Uma página que não é do painel (about:blank) tenta enquadrar as duas entradas.
  await page.setContent(
    `<iframe title="painel" src="${origem}/entrar"></iframe>` +
      `<iframe title="admin" src="${origem}/admin/entrar"></iframe>`,
  );
  // O navegador recusa cada um e diz por quê (a mensagem só traz a origem).
  await expect.poll(() => recusas.length).toBeGreaterThanOrEqual(2);
  await expect(page.frameLocator('iframe[title="painel"]').getByLabel('E-mail')).toHaveCount(0);
  await expect(page.frameLocator('iframe[title="admin"]').getByLabel('E-mail')).toHaveCount(0);
});

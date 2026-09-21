/**
 * A página pública da política de privacidade, de ponta a ponta.
 *
 * `lib/politica-de-privacidade.test.ts` prova o texto; aqui se prova a
 * LIGAÇÃO — que a página lê a loja certa, que um id qualquer não vira consulta
 * ao banco, e que o push só é descrito quando a loja realmente o tem. O
 * revisor da Apple abre este endereço antes de aprovar o app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const LOJA = '11111111-1111-4111-8111-111111111111';

/** O que o banco falso devolve para cada tabela. */
let linhaDaLoja: Record<string, unknown> | null = null;
let linhaDoApp: Record<string, unknown> | null = null;
/** As consultas feitas, com as colunas pedidas e o filtro. */
let consultas: { tabela: string; colunas: string; valor: unknown }[] = [];

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave',
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => ({
    from: (tabela: string) => ({
      select: (colunas: string) => ({
        eq: (_coluna: string, valor: unknown) => {
          consultas.push({ tabela, colunas, valor });
          return {
            maybeSingle: () =>
              Promise.resolve({
                data: tabela === 'stores' ? linhaDaLoja : linhaDoApp,
                error: null,
              }),
          };
        },
      }),
    }),
  }),
}));

const { default: PaginaDaPolitica } = await import('@/app/privacy/[loja]/page');

beforeEach(() => {
  consultas = [];
  linhaDaLoja = {
    name: 'Loja da Ana',
    primary_url: 'https://lojadaana.com.br',
    support_email: 'atendimento@lojadaana.com.br',
    updated_at: '2026-09-19T12:00:00.000Z',
  };
  linhaDoApp = { onesignal_app_id: 'os-1', device_secret_enc: 'cifrado' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Renderiza a página e devolve o HTML. */
async function renderizar(id: string): Promise<string> {
  const elemento = await PaginaDaPolitica({ params: Promise.resolve({ loja: id }) });
  return renderToStaticMarkup(elemento);
}

/**
 * A página respondeu 404?
 *
 * `rejects.toThrow()` não serve: um `TypeError` de campo nulo também é um
 * throw, e o teste passaria com a página quebrada em vez de devolvendo 404.
 * O `notFound()` do Next joga um erro com este `digest`.
 */
async function respondeu404(id: string): Promise<boolean> {
  try {
    await renderizar(id);
    return false;
  } catch (erro) {
    const digest = (erro as { digest?: unknown }).digest;
    return typeof digest === 'string' && digest.includes('404');
  }
}

describe('GET /privacy/[loja]', () => {
  it('mostra a política da loja pedida', async () => {
    const html = await renderizar(LOJA);

    expect(html).toContain('Loja da Ana');
    expect(html).toContain('lojadaana.com.br');
    expect(html).toContain('atendimento@lojadaana.com.br');
    expect(consultas.find((c) => c.tabela === 'stores')?.valor).toBe(LOJA);
  });

  /*
   * A página é pública, e `stores` guarda o token da Shopify. O painel inteiro
   * pede coluna a coluna por isso; aqui não pode ser diferente — um `select
   * *` numa página sem login é o tipo de linha que ninguém revisa duas vezes.
   */
  it('pede da loja só as três colunas públicas', async () => {
    await renderizar(LOJA);

    const daLoja = consultas.find((c) => c.tabela === 'stores');
    expect(daLoja?.colunas).toBe('name, primary_url, support_email, updated_at');
    expect(daLoja?.colunas).not.toContain('*');

    const doApp = consultas.find((c) => c.tabela === 'apps');
    expect(doApp?.colunas).not.toContain('*');
  });

  /*
   * O push só entra quando a loja REALMENTE o tem ligado. Uma política que
   * descreve notificações num app que não notifica é uma mentira que o revisor
   * às vezes pega.
   */
  it('descreve notificações só quando a loja tem push', async () => {
    expect(await renderizar(LOJA)).toContain('OneSignal');

    linhaDoApp = { onesignal_app_id: null, device_secret_enc: 'cifrado' };
    expect(await renderizar(LOJA)).not.toContain('OneSignal');
  });

  it('descreve o carrinho só quando o app consegue reportá-lo', async () => {
    linhaDoApp = { onesignal_app_id: null, device_secret_enc: null };
    const html = await renderizar(LOJA);
    expect(html).not.toContain('itens adicionados ao carrinho');
  });

  /** Um id que não é uuid não pode virar consulta: o Postgres estouraria. */
  it('id fora do formato vira 404 sem tocar no banco', async () => {
    for (const ruim of ['nao-e-uuid', '../../etc/passwd', '', "1' or '1'='1"]) {
      expect(await respondeu404(ruim), ruim).toBe(true);
      expect(consultas).toEqual([]);
    }
  });

  it('loja inexistente vira 404', async () => {
    linhaDaLoja = null;
    expect(await respondeu404(LOJA)).toBe(true);
  });

  /*
   * A página é pública e não pode carregar segredo nenhum: o revisor da Apple
   * e qualquer pessoa com o link abrem este HTML.
   */
  it('nada de segredo escapa para o HTML público', async () => {
    linhaDaLoja = {
      ...linhaDaLoja,
      shopify_access_token_enc: 'shpat_segredo',
    };
    const html = await renderizar(LOJA);

    for (const segredo of ['shpat_', 'cifrado', 'os-1', '_enc', 'service_role']) {
      expect(html, segredo).not.toContain(segredo);
    }
  });
});

/**
 * O endereço que o site da loja consulta, de ponta a ponta.
 *
 * `lib/banner-do-app.test.ts` prova a montagem; aqui se prova a LIGAÇÃO, que é
 * onde mora o risco: este endereço é PÚBLICO, sem sessão e sem segredo, e fica
 * na vitrine de todos os clientes. O que ele não pode fazer é virar uma forma
 * de enumerar as lojas da Storefy, e não pode quebrar a loja quando algo do
 * nosso lado falhar.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { RespostaDoBanner } from '@/lib/banner-do-app';

/** O que o banco devolve em cada consulta deste teste. */
let loja: { id: string } | null = { id: 'loja-1' };
let app: {
  id: string;
  ios_asc_app_id: string | null;
  package_android: string | null;
} | null = {
  id: 'app-1',
  ios_asc_app_id: '6478123456',
  package_android: 'br.com.oakvintage.app',
};
let configPublicada: unknown = null;
let explodir = false;

/** As tabelas consultadas, para provar o que a rota NÃO leu. */
let tabelas: string[] = [];

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave',
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => {
    if (explodir) throw new Error('banco fora do ar');
    return {
      from: (tabela: string) => {
        tabelas.push(tabela);
        const resultado =
          tabela === 'stores'
            ? { data: loja, error: null }
            : tabela === 'apps'
              ? { data: app, error: null }
              : { data: configPublicada == null ? null : { config: configPublicada }, error: null };

        const encadeavel: Record<string, unknown> = {
          maybeSingle: () => Promise.resolve(resultado),
        };
        for (const metodo of ['select', 'eq', 'order', 'limit']) {
          encadeavel[metodo] = () => encadeavel;
        }
        return encadeavel;
      },
    };
  },
}));

const { GET } = await import('@/app/api/public/banner/[loja]/route');

let erros: MockInstance<typeof console.error>;

const CONFIG = {
  version: 1,
  store: { name: 'Oak', url: 'https://oak.com.br', domains: ['oak.com.br'] },
  theme: {
    primary: '#111111',
    background: '#ffffff',
    text: '#111111',
    tabBarBg: '#ffffff',
    tabBarActive: '#111111',
    tabBarInactive: '#999999',
    statusBar: 'dark',
  },
  tabs: [
    { id: 'inicio', label: 'Início', icon: 'house', type: 'webview', url: '/' },
    { id: 'conta', label: 'Conta', icon: 'user', type: 'account' },
  ],
  webview: { hideSelectors: [] },
  features: {
    pushPromptTiming: 'onboarding',
    onboardingSlides: [],
    appBanner: { enabled: true, text: 'Baixe o app da Oak' },
  },
};

beforeEach(() => {
  loja = { id: 'loja-1' };
  app = { id: 'app-1', ios_asc_app_id: '6478123456', package_android: 'br.com.oakvintage.app' };
  configPublicada = CONFIG;
  explodir = false;
  tabelas = [];
  erros = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  erros.mockRestore();
});

function chamar(dominio: string) {
  return GET(new Request(`https://app.storefy.com.br/api/public/banner/${dominio}`), {
    params: Promise.resolve({ loja: dominio }),
  });
}

/** O corpo já tipado: `json()` devolve `any`, e `any` esconde erro de forma. */
async function corpo(resposta: Response): Promise<RespostaDoBanner> {
  return (await resposta.json()) as RespostaDoBanner;
}

describe('GET /api/public/banner/[loja]', () => {
  it('devolve o convite da loja conectada', async () => {
    const resposta = await chamar('oak-vintage.myshopify.com');

    expect(resposta.status).toBe(200);
    expect(await corpo(resposta)).toEqual({
      ativo: true,
      texto: 'Baixe o app da Oak',
      ios: 'https://apps.apple.com/app/id6478123456',
      android: 'https://play.google.com/store/apps/details?id=br.com.oakvintage.app',
      smartBanner: 'app-id=6478123456',
    });
  });

  /*
   * O bloco roda no domínio da loja, que é outro domínio. Sem CORS o navegador
   * descarta a resposta antes de o JavaScript vê-la, e o banner nunca
   * apareceria — sem erro nenhum na tela do lojista.
   */
  it('responde com CORS e cache de borda', async () => {
    const resposta = await chamar('oak-vintage.myshopify.com');

    expect(resposta.headers.get('access-control-allow-origin')).toBe('*');
    expect(resposta.headers.get('cache-control')).toContain('s-maxage=60');
  });

  /*
   * O domínio vem da URL. Sem o crivo, este endereço viraria uma consulta
   * livre por texto na tabela de lojas de todos os clientes.
   */
  it('domínio que não é de loja Shopify nem chega ao banco', async () => {
    for (const dominio of ['evil.com', 'oak.myshopify.com.evil.com', 'x', '..%2F..%2Fetc']) {
      const resposta = await chamar(dominio);
      expect((await corpo(resposta)).ativo, dominio).toBe(false);
      expect(tabelas, dominio).toEqual([]);
    }
  });

  it('loja que não é nossa devolve desligado, e não 404', async () => {
    loja = null;

    const resposta = await chamar('nao-e-nossa.myshopify.com');

    expect(resposta.status).toBe(200);
    expect((await corpo(resposta)).ativo).toBe(false);
  });

  it('sem config publicada, o banner fica desligado', async () => {
    configPublicada = null;

    expect((await corpo(await chamar('oak-vintage.myshopify.com'))).ativo).toBe(false);
  });

  it('config quebrada no banco não derruba a vitrine', async () => {
    configPublicada = { isto: 'não é uma AppConfig' };

    const resposta = await chamar('oak-vintage.myshopify.com');

    expect(resposta.status).toBe(200);
    expect((await corpo(resposta)).ativo).toBe(false);
  });

  it('banner desligado na config sai desligado', async () => {
    configPublicada = {
      ...CONFIG,
      features: { ...CONFIG.features, appBanner: { enabled: false, text: 'oi' } },
    };

    expect((await corpo(await chamar('oak-vintage.myshopify.com'))).ativo).toBe(false);
  });

  /* Uma falha nossa não pode aparecer como erro na loja de quem nos paga. */
  it('falha do banco vira desligado, e não 500', async () => {
    explodir = true;

    const resposta = await chamar('oak-vintage.myshopify.com');

    expect(resposta.status).toBe(200);
    expect((await corpo(resposta)).ativo).toBe(false);
  });

  /*
   * A rota lê `stores`, `apps` e `app_configs` — e nada mais. Um `select` em
   * tabela com segredo aqui seria um vazamento numa rota sem autenticação
   * nenhuma.
   */
  it('não encosta em tabela que não seja as três', async () => {
    await chamar('oak-vintage.myshopify.com');

    expect([...new Set(tabelas)].sort()).toEqual(['app_configs', 'apps', 'stores']);
  });
});

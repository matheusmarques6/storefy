import { describe, expect, it } from 'vitest';
import { configInicial, type AppConfig } from '@storefy/config-schema';
import { decidirRascunho, type DadosDaLojaNoBanco } from '@/lib/rascunho';

const LOJA: DadosDaLojaNoBanco = {
  name: 'Oak Vintage',
  primary_url: 'https://oakvintage.com.br',
  shop_domain: 'oak-vintage.myshopify.com',
  platform: 'shopify' as const,
};

/** Um rascunho salvo quando a loja estava exatamente como `LOJA`. */
function salvoCom(versao: number): AppConfig {
  return configInicial(
    {
      name: LOJA.name,
      url: LOJA.primary_url,
      shopDomain: LOJA.shop_domain,
      platform: LOJA.platform,
    },
    versao,
  );
}

describe('decidirRascunho', () => {
  it('cria o primeiro rascunho quando o app não tem nenhum', () => {
    const decisao = decidirRascunho(LOJA, null, 0);
    expect(decisao.acao).toBe('criar');
    expect(decisao.version).toBe(1);
    expect(decisao.config.store.name).toBe('Oak Vintage');
    expect(decisao.config.store.domains).toEqual([
      'oakvintage.com.br',
      'oak-vintage.myshopify.com',
    ]);
  });

  it('NÃO reaproveita número de versão já usado', () => {
    // `app_configs` tem unique (app_id, version): repetir o número faria o
    // insert falhar, e o histórico ficaria com dois registros disputando a
    // mesma versão.
    expect(decidirRascunho(LOJA, null, 7).version).toBe(8);
  });

  it('usa o rascunho que está lá quando ele é válido', () => {
    const guardada = salvoCom(4);
    guardada.theme.primary = '#ff0000';

    const decisao = decidirRascunho(LOJA, { version: 4, config: guardada }, 4);
    expect(decisao.acao).toBe('usar');
    expect(decisao.version).toBe(4);
    expect(decisao.config.theme.primary).toBe('#ff0000');
  });

  it('completa os defaults de um rascunho gravado antes de um campo existir', () => {
    const antiga = {
      version: 2,
      // Sem `platform`: o rascunho é de antes do campo existir.
      store: {
        name: 'Oak Vintage',
        url: 'https://oakvintage.com.br',
        domains: ['oakvintage.com.br', 'oak-vintage.myshopify.com'],
      },
      theme: {
        primary: '#000',
        background: '#fff',
        text: '#000',
        tabBarBg: '#fff',
        tabBarActive: '#000',
        tabBarInactive: '#999',
        statusBar: 'dark',
      },
      tabs: [
        { id: 'a', label: 'A', icon: 'house', type: 'webview', url: '/' },
        { id: 'b', label: 'B', icon: 'user', type: 'account' },
      ],
      webview: { hideSelectors: [] },
      features: {
        pushPromptTiming: 'onboarding',
        onboardingSlides: [],
        appBanner: { enabled: false, text: '' },
      },
    };
    const decisao = decidirRascunho(LOJA, { version: 2, config: antiga }, 2);
    expect(decisao.acao).toBe('usar');
    expect(decisao.config.minSupportedBuild).toBe(1);
    expect(decisao.config.webview.pullToRefresh).toBe(true);
  });

  /*
   * A loja mudou na tela dela depois do rascunho. Sem regravar o `store`,
   * "Publicar" sem mexer no editor poria no ar o endereço antigo — ou a
   * marcação de carrinho da plataforma errada.
   */
  it('ATUALIZA o bloco da loja quando o cadastro mudou, e mantém o resto', () => {
    const guardada = salvoCom(6);
    guardada.theme.primary = '#123456';

    const mudou = decidirRascunho(
      { ...LOJA, name: 'Oak Store', primary_url: 'https://oakstore.com.br', platform: 'other' },
      { version: 6, config: guardada },
      6,
    );
    expect(mudou.acao).toBe('atualizar');
    expect(mudou.version).toBe(6);
    expect(mudou.config.store).toEqual({
      name: 'Oak Store',
      url: 'https://oakstore.com.br',
      domains: ['oakstore.com.br', 'oak-vintage.myshopify.com'],
      platform: 'other',
    });
    // O que o lojista montou no editor fica.
    expect(mudou.config.theme.primary).toBe('#123456');
    expect(mudou.config.tabs).toEqual(guardada.tabs);
  });

  it('só a plataforma mudou: também atualiza', () => {
    const decisao = decidirRascunho(
      { ...LOJA, platform: 'other' },
      { version: 3, config: salvoCom(3) },
      3,
    );
    expect(decisao.acao).toBe('atualizar');
    expect(decisao.config.store.platform).toBe('other');
  });

  it('CONSERTA o rascunho ilegível em vez de abrir o editor em cima de lixo', () => {
    // Formulário sem valores e um "publicar" que gravaria lixo no app do
    // cliente é pior do que perder personalizações que já estavam ilegíveis.
    for (const quebrada of [null, {}, { version: 3 }, 'texto', [], { tabs: [] }]) {
      const decisao = decidirRascunho(LOJA, { version: 3, config: quebrada }, 3);
      expect(decisao.acao).toBe('consertar');
      expect(decisao.version).toBe(3);
      expect(decisao.config.store.url).toBe('https://oakvintage.com.br');
      expect(decisao.config.version).toBe(3);
    }
  });

  it('conserto mantém o número da versão, sem abrir outra', () => {
    // Abrir uma versão nova para consertar empurraria o histórico para a
    // frente por um problema que não foi o lojista que causou.
    const decisao = decidirRascunho(LOJA, { version: 9, config: { lixo: true } }, 9);
    expect(decisao.version).toBe(9);
  });

  it('a config decidida sempre traz o version de dentro igual ao da linha', () => {
    // O app compara esse número com o do cache para decidir o que é mais novo.
    for (const caso of [
      decidirRascunho(LOJA, null, 4),
      decidirRascunho(LOJA, { version: 6, config: { lixo: 1 } }, 6),
      decidirRascunho(LOJA, { version: 2, config: configInicial(LOJA_COMO_DADOS, 2) }, 2),
    ]) {
      expect(caso.config.version).toBe(caso.version);
    }
  });
});

const LOJA_COMO_DADOS = { name: LOJA.name, url: LOJA.primary_url, shopDomain: LOJA.shop_domain };

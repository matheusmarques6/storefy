import { describe, expect, it } from 'vitest';
import { safeParseAppConfig } from './index';
import { ABAS_PADRAO, configInicial, dominiosDaLoja } from './inicial';

const LOJA = { name: 'Oak Vintage', url: 'https://oakvintage.com.br' };

describe('dominiosDaLoja', () => {
  it('tira o www, que a comparação do bridge já cobre', () => {
    // `mesmoDominio` compara por limite de ponto: `loja.com.br` cobre
    // `www.loja.com.br` e qualquer subdomínio. Listar os dois não cobre nada
    // a mais e só faz a lista crescer.
    expect(dominiosDaLoja('https://www.oakvintage.com.br')).toEqual(['oakvintage.com.br']);
    expect(dominiosDaLoja('https://oakvintage.com.br/colecoes')).toEqual(['oakvintage.com.br']);
  });

  it('inclui o domínio myshopify quando conhecido', () => {
    // Login e alguns apps de terceiro redirecionam para lá; sem ele o cliente
    // sairia do app no meio do fluxo.
    expect(dominiosDaLoja('https://oakvintage.com.br', 'oak-vintage.myshopify.com')).toEqual([
      'oakvintage.com.br',
      'oak-vintage.myshopify.com',
    ]);
  });

  it('não repete quando os dois são o mesmo domínio', () => {
    expect(
      dominiosDaLoja('https://oak-vintage.myshopify.com', 'oak-vintage.myshopify.com'),
    ).toEqual(['oak-vintage.myshopify.com']);
  });

  it('aceita domínio sem esquema, como vem de stores.shop_domain', () => {
    expect(dominiosDaLoja('oakvintage.com.br')).toEqual(['oakvintage.com.br']);
  });

  it('ignora porta e maiúsculas', () => {
    expect(dominiosDaLoja('https://OakVintage.com.BR:8443')).toEqual(['oakvintage.com.br']);
  });

  it('devolve lista vazia em vez de estourar com entrada inválida', () => {
    expect(dominiosDaLoja('')).toEqual([]);
    expect(dominiosDaLoja('   ')).toEqual([]);
    expect(dominiosDaLoja('não é url')).toEqual([]);
    expect(dominiosDaLoja('https://oakvintage.com.br', '  ')).toEqual(['oakvintage.com.br']);
  });
});

describe('configInicial', () => {
  it('sai válida pelo AppConfigSchema', () => {
    // É a garantia que importa: o que nasce aqui é o que o app vai consumir.
    expect(safeParseAppConfig(configInicial(LOJA)).success).toBe(true);
  });

  it('leva o nome e o endereço do cadastro, e nada mais da loja', () => {
    const config = configInicial({ name: '  Oak Vintage  ', url: 'https://oakvintage.com.br' });
    expect(config.store).toEqual({
      name: 'Oak Vintage',
      url: 'https://oakvintage.com.br',
      domains: ['oakvintage.com.br'],
      // Sem `platform` no cadastro, a config nasce Shopify: é o produto, e é
      // o que mantém a atribuição de receita ligada.
      platform: 'shopify',
    });
  });

  it('respeita a plataforma do cadastro quando a loja não é Shopify', () => {
    const config = configInicial({ ...LOJA, platform: 'other' });
    expect(config.store.platform).toBe('other');
  });

  it('nasce com um app que já funciona', () => {
    const config = configInicial(LOJA);
    expect(config.tabs.map((aba) => aba.type)).toEqual(['webview', 'search', 'cart', 'account']);
    expect(config.tabs).toHaveLength(ABAS_PADRAO.length);
    // O badge do carrinho vem ligado: é o que mostra que o app é app.
    expect(config.tabs.find((aba) => aba.type === 'cart')?.badge).toBe('cart_count');
  });

  it('NÃO esconde nada do tema por conta própria', () => {
    // Esconder o cabeçalho errado quebra a navegação da loja. Quem escolhe é o
    // lojista, no seletor visual do editor.
    expect(configInicial(LOJA).webview.hideSelectors).toEqual([]);
    expect(configInicial(LOJA).webview.customCss).toBe('');
    expect(configInicial(LOJA).webview.customJs).toBe('');
  });

  it('não inventa cor de marca', () => {
    // Cinza neutro declarado como padrão, não um chute sobre a marca de
    // ninguém. A detecção automática troca isso pelas cores reais do site.
    const { theme } = configInicial(LOJA);
    expect(theme.background).toBe('#ffffff');
    expect(theme.statusBar).toBe('dark');
    expect(theme.primary).toBe(theme.text);
  });

  it('começa na versão 1 e aceita outra quando pedida', () => {
    expect(configInicial(LOJA).version).toBe(1);
    expect(configInicial(LOJA, 7).version).toBe(7);
  });

  it('respeita os limites da tab bar', () => {
    const config = configInicial(LOJA);
    expect(config.tabs.length).toBeGreaterThanOrEqual(2);
    expect(config.tabs.length).toBeLessThanOrEqual(5);
    for (const aba of config.tabs) {
      expect(aba.label.length).toBeLessThanOrEqual(12);
      expect(aba.id.trim()).not.toBe('');
    }
  });

  it('os ids das abas não se repetem', () => {
    // Id repetido faria duas abas disputarem a mesma WebView.
    const ids = configInicial(LOJA).tabs.map((aba) => aba.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada chamada devolve um objeto novo', () => {
    // Compartilhar o array de abas faria a edição de uma loja vazar na outra.
    const a = configInicial(LOJA);
    const b = configInicial(LOJA);
    expect(a).not.toBe(b);
    expect(a.tabs).not.toBe(b.tabs);

    const primeira = a.tabs[0];
    if (primeira === undefined) throw new Error('a config inicial veio sem abas');
    primeira.label = 'Trocado';
    expect(b.tabs[0]?.label).toBe('Início');
  });
});

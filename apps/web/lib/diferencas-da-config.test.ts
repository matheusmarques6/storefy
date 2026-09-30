import { describe, expect, it } from 'vitest';
import { blocoDaLoja, configInicial, type AppConfig } from '@storefy/config-schema';
import { diferencasDaConfig, diferencasDosDadosDaLoja } from '@/lib/diferencas-da-config';

const NO_AR: AppConfig = configInicial(
  { name: 'Oak Vintage', url: 'https://oakvintage.com.br', shopDomain: null, platform: 'shopify' },
  3,
);

function copia(): AppConfig {
  return structuredClone({ ...NO_AR, version: 4 });
}

function textos(de: AppConfig, para: AppConfig): string[] {
  return diferencasDaConfig(de, para).map((diferenca) => diferenca.texto);
}

describe('diferencasDaConfig', () => {
  it('iguais, a não ser pela versão: nada muda', () => {
    expect(diferencasDaConfig(NO_AR, copia())).toEqual([]);
  });

  it('cada cor é uma frase, com o antes e o depois; maiúscula não é mudança', () => {
    const rascunho = copia();
    rascunho.theme.primary = '#be123c';
    rascunho.theme.background = NO_AR.theme.background.toUpperCase();
    rascunho.theme.statusBar = 'light';
    expect(diferencasDaConfig(NO_AR, rascunho)).toEqual([
      { secao: 'Aparência', texto: `Cor principal: ${NO_AR.theme.primary} → #be123c` },
      { secao: 'Aparência', texto: 'Barra de status: ícones claros' },
    ]);
  });

  it('abas: renomeada, alterada, nova, removida e a ordem, cada uma uma frase', () => {
    const rascunho = copia();
    const [inicio, busca, carrinho, conta] = rascunho.tabs;
    if (
      inicio === undefined ||
      busca === undefined ||
      carrinho === undefined ||
      conta === undefined
    ) {
      throw new Error('config sem as quatro abas padrão');
    }
    rascunho.tabs = [
      { ...busca, label: 'Procurar' },
      { ...inicio, icon: 'star', url: '/collections/all' },
      carrinho,
      {
        id: 'promo',
        label: 'Promoções',
        icon: 'tag',
        type: 'webview',
        url: '/pages/promo',
        badge: 'none',
      },
    ];
    expect(textos(NO_AR, rascunho)).toEqual([
      'Aba “Buscar” agora se chama “Procurar”',
      'Aba “Início”: ícone novo, endereço /collections/all',
      'Aba nova: “Promoções”',
      `Aba removida: “${conta.label}”`,
      'Nova ordem das abas: Procurar, Início, Carrinho, Promoções',
    ]);
  });

  /* Antes, desligar o número da caixa de avisos aparecia como "sem o número do carrinho". */
  it('o número sobre o ícone é dito pelo que ele conta', () => {
    const avisos = {
      id: 'avisos',
      label: 'Avisos',
      icon: 'bell',
      type: 'notifications' as const,
      badge: 'unread' as const,
    };
    const antes = copia();
    antes.tabs = [...antes.tabs.slice(0, 3), avisos];
    const depois = structuredClone(antes);
    depois.tabs = depois.tabs.map((aba) =>
      aba.id === 'avisos' || aba.id === 'carrinho' ? { ...aba, badge: 'none' as const } : aba,
    );

    expect(textos(antes, depois)).toEqual([
      'Aba “Carrinho”: sem o número do carrinho',
      'Aba “Avisos”: sem o número de avisos',
    ]);
    expect(textos(depois, antes)).toEqual([
      'Aba “Carrinho”: mostra o número do carrinho',
      'Aba “Avisos”: mostra quantos avisos não foram lidos',
    ]);
  });

  it('a mesma aba com as chaves em outra ordem não é mudança (o banco não guarda a ordem)', () => {
    const rascunho = copia();
    rascunho.tabs = rascunho.tabs.map(
      (aba) =>
        Object.fromEntries(Object.entries(aba).reverse()) as unknown as AppConfig['tabs'][number],
    );
    expect(diferencasDaConfig(NO_AR, rascunho)).toEqual([]);
  });

  it('itens escondidos dizem o que passa a esconder e o que volta a aparecer', () => {
    const antes = copia();
    antes.webview.hideSelectors = ['.rodape', '.banner'];
    const depois = copia();
    depois.webview.hideSelectors = ['.rodape', '.cabecalho'];
    depois.webview.customCss = 'body { margin: 0 }';
    expect(textos(antes, depois)).toEqual([
      'Itens escondidos da loja: passa a esconder “.cabecalho”; volta a mostrar “.banner”',
      'CSS aplicado na loja mudou',
    ]);
  });

  it('recursos, aviso no topo e atualização obrigatória, em frases de ligar e desligar', () => {
    const rascunho = copia();
    rascunho.features.biometricLogin = !NO_AR.features.biometricLogin;
    rascunho.features.appBanner = { enabled: true, text: 'Baixe o app' };
    rascunho.announcement = { enabled: true, text: ' Frete grátis ', url: '/pages/frete' };
    rascunho.minSupportedBuild = 12;
    expect(textos(NO_AR, rascunho)).toEqual([
      `Banner “baixe o app”: ligado`,
      `Proteger a conta com Face ID ou digital: ${rascunho.features.biometricLogin ? 'ligado' : 'desligado'}`,
      'Aviso no topo: ligado',
      'Texto do aviso no topo: “Frete grátis”',
      'Link do aviso no topo: /pages/frete',
      'Atualização obrigatória: exige a versão 1.0.12',
    ]);
  });

  it('config antiga, sem o aviso, é o mesmo que aviso desligado', () => {
    const antiga = copia();
    delete antiga.announcement;
    const rascunho = copia();
    rascunho.announcement = { enabled: false, text: '' };
    expect(diferencasDaConfig(antiga, rascunho)).toEqual([]);
  });

  it('os dados da loja, que vêm da tela da loja, aparecem à parte', () => {
    const rascunho = copia();
    rascunho.store = { ...rascunho.store, name: 'Oak Vintage Store' };
    expect(diferencasDaConfig(NO_AR, rascunho)).toEqual([
      { secao: 'Dados da loja', texto: 'Nome da loja: “Oak Vintage Store”' },
    ]);
  });
});

describe('diferencasDosDadosDaLoja', () => {
  const loja = (nome: string, url: string, shopDomain: string | null = null) =>
    blocoDaLoja({ name: nome, url, shopDomain, platform: 'shopify' });

  it('o mesmo bloco não tem o que avisar', () => {
    const noAr = loja('Oak Vintage', 'https://oakvintage.com.br');
    expect(diferencasDosDadosDaLoja(noAr, structuredClone(noAr))).toEqual([]);
  });

  it('o endereço novo e o nome novo, em frases; os domínios que seguem o endereço também', () => {
    const noAr = loja('Oak Vintage', 'https://oakvintage.com.br');
    const agora = loja('Oak & Co', 'https://oakeco.com.br');
    expect(diferencasDosDadosDaLoja(noAr, agora).map((diferenca) => diferenca.texto)).toEqual([
      'Nome da loja: “Oak & Co”',
      'Endereço da loja: https://oakeco.com.br',
      'Domínios da loja atualizados',
    ]);
  });
});

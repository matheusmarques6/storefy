import { describe, expect, it } from 'vitest';
import { configInicial, type AppConfig } from '@storefy/config-schema';
import {
  conteudoDaConfig,
  descricaoDasMudancas,
  impressaoDaConfig,
  mudancasPendentes,
} from '@/lib/mudancas-pendentes';

const NO_AR: AppConfig = configInicial(
  { name: 'Oak Vintage', url: 'https://oakvintage.com.br', shopDomain: null, platform: 'shopify' },
  3,
);

function copia(): AppConfig {
  return structuredClone({ ...NO_AR, version: 4 });
}

describe('mudancasPendentes', () => {
  it('o rascunho recém-aberto, igual ao no ar, não tem mudança — a versão não conta', () => {
    expect(mudancasPendentes(copia(), NO_AR)).toBe(0);
  });

  it('cada cor conta uma', () => {
    const rascunho = copia();
    rascunho.theme.primary = '#1d4ed8';
    rascunho.theme.tabBarActive = '#1d4ed8';
    expect(mudancasPendentes(rascunho, NO_AR)).toBe(2);
  });

  it('renomear uma aba é uma mudança; trocar duas de lugar também é uma', () => {
    const renomeada = copia();
    renomeada.tabs[0] = { ...renomeada.tabs[0], label: 'Loja' } as AppConfig['tabs'][number];
    expect(mudancasPendentes(renomeada, NO_AR)).toBe(1);

    const trocada = copia();
    const [primeira, segunda, ...resto] = trocada.tabs;
    if (primeira === undefined || segunda === undefined) throw new Error('config sem abas');
    trocada.tabs = [segunda, primeira, ...resto];
    expect(mudancasPendentes(trocada, NO_AR)).toBe(1);
  });

  it('tirar uma aba conta uma, e não mexe na conta da ordem das outras', () => {
    const sem = copia();
    sem.tabs = sem.tabs.filter((aba) => aba.id !== 'busca');
    expect(mudancasPendentes(sem, NO_AR)).toBe(1);
  });

  it('esconder um elemento da loja é uma mudança na seção da WebView', () => {
    const rascunho = copia();
    rascunho.webview.hideSelectors = ['.cabecalho'];
    expect(mudancasPendentes(rascunho, NO_AR)).toBe(1);
  });

  it('a mesma aba com as chaves em outra ordem não é mudança (o banco não guarda a ordem)', () => {
    const rascunho = copia();
    rascunho.tabs = rascunho.tabs.map(
      (aba) =>
        Object.fromEntries(Object.entries(aba).reverse()) as unknown as AppConfig['tabs'][number],
    );
    rascunho.theme = Object.fromEntries(
      Object.entries(rascunho.theme).reverse(),
    ) as unknown as AppConfig['theme'];
    expect(mudancasPendentes(rascunho, NO_AR)).toBe(0);
  });
});

describe('conteudoDaConfig', () => {
  it('ignora versão e loja, que o servidor reescreve, e a ordem das chaves', () => {
    const doServidor = copia();
    doServidor.version = 9;
    doServidor.store = { ...doServidor.store, name: 'Outro nome' };
    const reordenada = Object.fromEntries(Object.entries(NO_AR).reverse()) as unknown as AppConfig;
    expect(conteudoDaConfig(doServidor)).toBe(conteudoDaConfig(NO_AR));
    expect(conteudoDaConfig(reordenada)).toBe(conteudoDaConfig(NO_AR));
  });

  it('muda com qualquer coisa que o lojista edita', () => {
    const rascunho = copia();
    rascunho.tabs[0] = { ...rascunho.tabs[0], label: 'Loja' } as AppConfig['tabs'][number];
    expect(conteudoDaConfig(rascunho)).not.toBe(conteudoDaConfig(NO_AR));
  });
});

describe('impressaoDaConfig', () => {
  it('é curta, e a mesma para o mesmo conteúdo em qualquer ordem, versão ou loja', () => {
    const doServidor = copia();
    doServidor.version = 9;
    doServidor.store = { ...doServidor.store, name: 'Outro nome' };
    const reordenada = Object.fromEntries(Object.entries(NO_AR).reverse()) as unknown as AppConfig;

    expect(impressaoDaConfig(NO_AR)).toMatch(/^[0-9a-f]{28}$/);
    expect(impressaoDaConfig(doServidor)).toBe(impressaoDaConfig(NO_AR));
    expect(impressaoDaConfig(reordenada)).toBe(impressaoDaConfig(NO_AR));
  });

  it('com ou sem os valores padrão preenchidos, é a mesma — o banco guarda a config lida', () => {
    const semPadroes = structuredClone(NO_AR) as Partial<AppConfig>;
    delete semPadroes.minSupportedBuild;
    expect(impressaoDaConfig(semPadroes as AppConfig)).toBe(impressaoDaConfig(NO_AR));
  });

  it('muda com qualquer coisa que o lojista edita, até uma letra', () => {
    const renomeada = copia();
    renomeada.tabs[0] = {
      ...renomeada.tabs[0],
      label: `${renomeada.tabs[0]?.label ?? ''}s`,
    } as AppConfig['tabs'][number];
    const colorida = copia();
    colorida.theme.primary = '#1d4ed9';

    const impressoes = new Set([renomeada, colorida, NO_AR].map(impressaoDaConfig));
    expect(impressoes.size).toBe(3);
  });
});

describe('descricaoDasMudancas', () => {
  it('fala no singular e no plural', () => {
    expect(descricaoDasMudancas(0)).toBe('Igual à versão no ar');
    expect(descricaoDasMudancas(1)).toBe('1 mudança desde a versão no ar');
    expect(descricaoDasMudancas(4)).toBe('4 mudanças desde a versão no ar');
  });
});

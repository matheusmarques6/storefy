import { describe, expect, it } from 'vitest';
import { configInicial } from '@storefy/config-schema';
import {
  MAX_ABAS,
  MIN_ABAS,
  adicionarAba,
  editarAba,
  editarRecursos,
  editarTema,
  editarWebview,
  idLivre,
  moverAba,
  podeAdicionarAba,
  podeRemoverAba,
  removerAba,
  tiposDisponiveis,
  validarConfig,
} from '@/lib/editor-de-config';

const LOJA = { name: 'Oak Vintage', url: 'https://oakvintage.com.br' };
const base = () => configInicial(LOJA);

describe('idLivre', () => {
  it('deriva do rótulo, para ficar legível no deep link', () => {
    expect(idLivre(base(), 'Promoções')).toBe('promocoes');
    expect(idLivre(base(), 'Lançamentos')).toBe('lancamentos');
  });

  it('desvia quando já existe', () => {
    const config = base();
    expect(idLivre(config, 'Carrinho')).toBe('carrinho-2');
  });

  it('cai num nome utilizável quando não sobra nada do rótulo', () => {
    expect(idLivre(base(), '!!!')).toBe('aba');
    expect(idLivre(base(), '   ')).toBe('aba');
  });

  it('o que sai sempre serve como id de aba', () => {
    for (const rotulo of ['Promoções', '   ', '!!!', 'A B C', '---', 'ÁÉÍÓÚ']) {
      expect(idLivre(base(), rotulo)).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });
});

describe('adicionar e remover abas', () => {
  it('não oferece duas vezes o que só faz sentido uma', () => {
    // Carrinho, conta e busca já estão na config inicial e só cabem uma vez;
    // sobra a página livre.
    expect(tiposDisponiveis(base(), { push: true })).toEqual(['webview', 'notifications']);
  });

  it('NÃO oferece a aba de avisos sem push configurado', () => {
    // O app esconde essa aba quando não há push. Oferecê-la aqui seria um
    // botão que não faz nada no celular do cliente.
    expect(tiposDisponiveis(base())).toEqual(['webview']);
    expect(adicionarAba(base(), 'notifications').tabs).toHaveLength(4);
    expect(adicionarAba(base(), 'notifications', { push: true }).tabs).toHaveLength(5);
  });

  it('respeita o teto de 5 abas', () => {
    let config = base();
    expect(config.tabs).toHaveLength(4);
    config = adicionarAba(config, 'webview');
    expect(config.tabs).toHaveLength(MAX_ABAS);
    expect(podeAdicionarAba(config, { push: true })).toBe(false);
    expect(adicionarAba(config, 'webview').tabs).toHaveLength(MAX_ABAS);
  });

  it('a aba nova já nasce usável', () => {
    const config = adicionarAba(base(), 'webview');
    const nova = config.tabs[config.tabs.length - 1];
    expect(nova?.label).toBe('Página');
    expect(nova?.url).toBe('/');
    expect(nova?.icon).not.toBe('');
    expect(nova?.badge).toBe('none');
  });

  it('a aba de carrinho nasce com o badge ligado', () => {
    const semCarrinho = removerAba(base(), 'carrinho');
    const comCarrinho = adicionarAba(semCarrinho, 'cart');
    expect(comCarrinho.tabs.find((aba) => aba.type === 'cart')?.badge).toBe('cart_count');
  });

  it('não deixa a barra ficar com menos de duas abas', () => {
    let config = base();
    config = removerAba(config, 'busca');
    config = removerAba(config, 'carrinho');
    expect(config.tabs).toHaveLength(MIN_ABAS);
    expect(podeRemoverAba(config)).toBe(false);
    expect(removerAba(config, 'conta').tabs).toHaveLength(MIN_ABAS);
  });

  it('remover uma aba que não existe não muda nada', () => {
    const config = base();
    expect(removerAba(config, 'inexistente')).toBe(config);
  });
});

describe('moverAba', () => {
  it('reordena a barra', () => {
    const config = moverAba(base(), 0, 2);
    expect(config.tabs.map((aba) => aba.id)).toEqual(['busca', 'carrinho', 'inicio', 'conta']);
  });

  it('move para trás também', () => {
    const config = moverAba(base(), 3, 0);
    expect(config.tabs.map((aba) => aba.id)).toEqual(['conta', 'inicio', 'busca', 'carrinho']);
  });

  it('índice fora do lugar devolve a config intacta', () => {
    const config = base();
    for (const [de, para] of [
      [-1, 0],
      [0, -1],
      [0, 9],
      [9, 0],
      [1, 1],
    ]) {
      expect(moverAba(config, de ?? 0, para ?? 0)).toBe(config);
    }
  });
});

describe('edições não mexem no original', () => {
  it('cada operação devolve uma config nova', () => {
    // O editor guarda o original para saber se há mudança não salva; mutar em
    // cima faria a barra de salvar nunca aparecer.
    const original = base();
    const copia = structuredClone(original);

    editarTema(original, { primary: '#ff0000' });
    editarAba(original, 'inicio', { label: 'Home' });
    editarWebview(original, { customCss: 'body{}' });
    editarRecursos(original, { rateAppPrompt: false });
    adicionarAba(original, 'webview');
    removerAba(original, 'busca');
    moverAba(original, 0, 1);

    expect(original).toEqual(copia);
  });

  it('editarAba mexe só na aba pedida', () => {
    const config = editarAba(base(), 'inicio', { label: 'Home' });
    expect(config.tabs[0]?.label).toBe('Home');
    expect(config.tabs[1]?.label).toBe('Buscar');
  });
});

describe('validarConfig', () => {
  it('a config inicial está pronta para ir ao ar', () => {
    expect(validarConfig(base())).toEqual([]);
  });

  it('avisa em português quando o rótulo não cabe na barra', () => {
    const config = editarAba(base(), 'inicio', { label: 'Nome gigantesco demais' });
    const problemas = validarConfig(config);
    expect(problemas.some((p) => p.secao === 'abas')).toBe(true);
    expect(problemas.map((p) => p.mensagem).join(' ')).toContain('12 caracteres');
  });

  it('pega dois rótulos iguais, que o schema deixa passar', () => {
    const config = editarAba(base(), 'busca', { label: 'Início' });
    const problemas = validarConfig(config);
    expect(problemas.map((p) => p.mensagem).join(' ')).toContain('mesmo nome');
  });

  it('pega cor inválida e aponta a seção de aparência', () => {
    const config = editarTema(base(), { primary: 'azul' });
    const problemas = validarConfig(config);
    expect(problemas.some((p) => p.secao === 'aparencia')).toBe(true);
  });

  it('pega aba de página sem endereço', () => {
    const config = editarAba(base(), 'inicio', { url: '  ' });
    expect(
      validarConfig(config)
        .map((p) => p.mensagem)
        .join(' '),
    ).toContain('precisa de um endereço');
  });

  it('pega seletor que é CSS livre disfarçado', () => {
    const config = editarWebview(base(), { hideSelectors: ['body{display:none}'] });
    const problemas = validarConfig(config);
    expect(problemas.some((p) => p.secao === 'loja')).toBe(true);
  });

  it('pega banner ligado e sem texto', () => {
    const config = editarRecursos(base(), { appBanner: { enabled: true, text: '   ' } });
    expect(
      validarConfig(config)
        .map((p) => p.mensagem)
        .join(' '),
    ).toContain('sem texto');
  });

  it('pega slide de boas-vindas pela metade', () => {
    const config = editarRecursos(base(), {
      onboardingSlides: [{ title: 'Bem-vindo', body: '', image: '' }],
    });
    expect(
      validarConfig(config)
        .map((p) => p.mensagem)
        .join(' '),
    ).toContain('sem título ou sem texto');
  });

  it('nenhuma mensagem fala a língua do Zod', () => {
    const config = editarTema(editarAba(base(), 'inicio', { label: '' }), { primary: 'x' });
    for (const problema of validarConfig(config)) {
      expect(problema.mensagem).not.toMatch(/zod|string|array|expected|invalid_/i);
    }
  });
});

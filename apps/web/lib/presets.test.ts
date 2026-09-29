/**
 * O que um preset troca, e — mais importante — o que ele NÃO toca.
 *
 * O estrago que isto evita: um preset que sobrescrevesse cores, nome e ícone
 * faria o lojista perder a tarde que passou ajustando a identidade da loja
 * para ganhar três seletores de CSS. O preset é sobre o TEMA, não sobre a
 * marca.
 */
import { describe, expect, it } from 'vitest';
import { configInicial } from '@storefy/config-schema';
import {
  aplicarPreset,
  lerPreset,
  lerPresets,
  resumoDaTroca,
  type PresetBruto,
} from '@/lib/presets';

const LOJA = configInicial({ name: 'Loja Teste', url: 'https://loja.com.br' });

const ABAS = [
  {
    id: 'inicio',
    label: 'Início',
    icon: 'home',
    type: 'webview' as const,
    url: '/',
    badge: 'none' as const,
  },
  {
    id: 'busca',
    label: 'Buscar',
    icon: 'search',
    type: 'webview' as const,
    url: '/search',
    badge: 'none' as const,
  },
  {
    id: 'conta',
    label: 'Conta',
    icon: 'user',
    type: 'webview' as const,
    url: '/account',
    badge: 'none' as const,
  },
];

const BRUTO: PresetBruto = {
  id: 'p1',
  nome: 'Dawn — padrão',
  tema: 'Dawn',
  descricao: 'Esconde cabeçalho e rodapé do tema Dawn.',
  tabs: ABAS,
  hide_selectors: ['header', '.footer'],
  custom_css: 'body { padding-top: 0 }',
};

describe('lerPreset', () => {
  it('lê um preset bem formado', () => {
    const lido = lerPreset(BRUTO);

    expect(lido.ok).toBe(true);
    if (lido.ok) {
      expect(lido.preset.tabs).toHaveLength(3);
      expect(lido.preset.hideSelectors).toEqual(['header', '.footer']);
    }
  });

  /*
   * Um preset salvo antes de o schema mudar não pode ser aplicado pela
   * metade: meia aplicação deixaria o app numa forma que nenhuma tela sabe
   * consertar.
   */
  it('preset com aba fora do schema é recusado com motivo', () => {
    const lido = lerPreset({ ...BRUTO, tabs: [{ id: 'COM MAIÚSCULA E ESPAÇO' }, {}] });

    expect(lido.ok).toBe(false);
    if (!lido.ok) expect(lido.motivo).toContain('formato');
  });

  it('preset com menos de duas abas é recusado', () => {
    expect(lerPreset({ ...BRUTO, tabs: [ABAS[0]] }).ok).toBe(false);
  });

  it('CSS nulo vira string vazia em vez de quebrar', () => {
    const lido = lerPreset({ ...BRUTO, custom_css: null });
    expect(lido.ok).toBe(true);
    if (lido.ok) expect(lido.preset.customCss).toBe('');
  });

  /* Uma linha ruim não pode derrubar a lista inteira. */
  it('lerPresets descarta o quebrado e mantém os bons', () => {
    const bons = lerPresets([BRUTO, { ...BRUTO, id: 'p2', tabs: 'nem é array' }]);

    expect(bons).toHaveLength(1);
    expect(bons[0]?.id).toBe('p1');
  });
});

describe('aplicarPreset', () => {
  const preset = (() => {
    const lido = lerPreset(BRUTO);
    if (!lido.ok) throw new Error('fixture inválida');
    return lido.preset;
  })();

  it('troca abas, seletores e CSS', () => {
    const r = aplicarPreset(LOJA, preset);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.tabs.map((a) => a.id)).toEqual(['inicio', 'busca', 'conta']);
      expect(r.config.webview.hideSelectors).toEqual(['header', '.footer']);
      expect(r.config.webview.customCss).toBe('body { padding-top: 0 }');
    }
  });

  /*
   * A asserção que define o produto: o preset é sobre o TEMA, não sobre a
   * marca. Se alguém fizer o preset carregar cores ou nome, isto cai.
   */
  it('NÃO toca na identidade da loja', () => {
    const r = aplicarPreset(LOJA, preset);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.store).toEqual(LOJA.store);
      expect(r.config.theme).toEqual(LOJA.theme);
      expect(r.config.features).toEqual(LOJA.features);
      expect(r.config.version).toBe(LOJA.version);
    }
  });

  /* O resto do webview — pull to refresh, user agent — é preferência da loja. */
  it('preserva o que no webview não é do tema', () => {
    const base = {
      ...LOJA,
      webview: { ...LOJA.webview, pullToRefresh: false, userAgentSuffix: 'Marca' },
    };
    const r = aplicarPreset(base, preset);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.webview.pullToRefresh).toBe(false);
      expect(r.config.webview.userAgentSuffix).toBe('Marca');
    }
  });

  it('devolve uma config nova, sem alterar a que entrou', () => {
    const antes = JSON.stringify(LOJA);
    aplicarPreset(LOJA, preset);
    expect(JSON.stringify(LOJA)).toBe(antes);
  });
});

describe('resumoDaTroca', () => {
  const preset = (() => {
    const lido = lerPreset(BRUTO);
    if (!lido.ok) throw new Error('fixture inválida');
    return lido.preset;
  })();

  /*
   * A confirmação não pode ser um "tem certeza?" vazio: aplicar SUBSTITUI as
   * abas que o lojista montou, e ele precisa ver o tamanho do estrago antes.
   */
  it('diz quais abas saem e quais entram', () => {
    const resumo = resumoDaTroca(LOJA, preset);
    expect(resumo.join(' ')).toContain('Início, Buscar, Conta');
  });

  it('não inventa mudança quando nada muda', () => {
    const aplicada = aplicarPreset(LOJA, preset);
    expect(aplicada.ok).toBe(true);
    if (aplicada.ok) expect(resumoDaTroca(aplicada.config, preset)).toEqual([]);
  });

  it('avisa que o CSS existente é substituído, e não só que há um novo', () => {
    const comCss = { ...LOJA, webview: { ...LOJA.webview, customCss: 'p { color: red }' } };
    expect(resumoDaTroca(comCss, preset).join(' ')).toContain('substituído');
  });
});

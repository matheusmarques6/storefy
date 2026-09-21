/**
 * O script de `window.Storefy` é EXECUTADO aqui, não só compilado.
 *
 * Ele roda dentro da página do lojista e é chamado pelo tema dele: o que
 * importa é o que cada função devolve e qual mensagem chega ao app — nada
 * disso aparece numa checagem de sintaxe.
 */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { MARCA_DA_API, gerarApiDaPagina } from './pagina';
import { lerMensagemDaWeb } from './mensagens';

type Registro = Record<string, unknown>;

interface Storefy {
  share: (url?: unknown, titulo?: unknown) => boolean;
  haptic: (estilo?: unknown) => boolean;
  openExternal: (url?: unknown) => boolean;
  requestPushPermission: () => boolean;
  notifyWhenBack: (variante?: unknown, caminho?: unknown) => boolean;
}

const PAGINA = 'https://oakvintage.com.br/products/jaqueta';

function criarPagina(opcoes: { semCanal?: boolean } = {}) {
  const mensagens: string[] = [];
  const janela: Registro = { location: { href: PAGINA, toString: () => PAGINA } };
  if (opcoes.semCanal !== true) {
    janela.ReactNativeWebView = {
      postMessage: (texto: string): void => {
        mensagens.push(texto);
      },
    };
  }
  janela.window = janela;
  const contexto = createContext(janela);

  return {
    janela,
    mensagens,
    injetar: (): void => {
      runInContext(gerarApiDaPagina(), contexto);
    },
    api: (): Storefy => janela.Storefy as Storefy,
  };
}

function unicaMensagem(mensagens: string[]): unknown {
  expect(mensagens).toHaveLength(1);
  const [primeira] = mensagens;
  if (primeira === undefined) throw new Error('nada foi postado');
  const lida = lerMensagemDaWeb(primeira);
  if (!lida.ok) throw new Error(`o próprio contrato recusou: ${lida.motivo}`);
  return lida.mensagem;
}

describe('window.Storefy', () => {
  it('instala as quatro funções do contrato', () => {
    const pagina = criarPagina();
    pagina.injetar();
    const api = pagina.api();
    expect(typeof api.share).toBe('function');
    expect(typeof api.haptic).toBe('function');
    expect(typeof api.openExternal).toBe('function');
    expect(typeof api.requestPushPermission).toBe('function');
    expect(typeof api.notifyWhenBack).toBe('function');
    expect((pagina.janela.Storefy as Registro)[MARCA_DA_API]).toBe(true);
  });

  it('compartilha a página atual quando o tema não passa URL', () => {
    const pagina = criarPagina();
    pagina.injetar();
    expect(pagina.api().share()).toBe(true);
    expect(unicaMensagem(pagina.mensagens)).toEqual({ type: 'SHARE', url: PAGINA });
  });

  it('compartilha com título quando o tema passa os dois', () => {
    const pagina = criarPagina();
    pagina.injetar();
    expect(pagina.api().share('https://oakvintage.com.br/p/2', '  Jaqueta jeans  ')).toBe(true);
    expect(unicaMensagem(pagina.mensagens)).toEqual({
      type: 'SHARE',
      url: 'https://oakvintage.com.br/p/2',
      title: 'Jaqueta jeans',
    });
  });

  it('cai no estilo mais leve quando o haptic vem errado', () => {
    // O tema é de terceiro: mandar `style: 'explodir'` faria o contrato
    // recusar a mensagem e a vibração sumiria sem explicação.
    for (const entrada of ['explodir', '', undefined, 42, null]) {
      const pagina = criarPagina();
      pagina.injetar();
      expect(pagina.api().haptic(entrada)).toBe(true);
      expect(unicaMensagem(pagina.mensagens)).toEqual({ type: 'HAPTIC', style: 'light' });
    }
  });

  it('respeita os estilos válidos', () => {
    for (const estilo of ['light', 'medium', 'success']) {
      const pagina = criarPagina();
      pagina.injetar();
      pagina.api().haptic(estilo);
      expect(unicaMensagem(pagina.mensagens)).toEqual({ type: 'HAPTIC', style: estilo });
    }
  });

  it('recusa openExternal sem URL em vez de mandar mensagem inválida', () => {
    const pagina = criarPagina();
    pagina.injetar();
    expect(pagina.api().openExternal()).toBe(false);
    expect(pagina.api().openExternal('   ')).toBe(false);
    expect(pagina.mensagens).toHaveLength(0);
  });

  it('inscreve no aviso de volta ao estoque', () => {
    const pagina = criarPagina();
    pagina.injetar();

    expect(pagina.api().notifyWhenBack('4412345', '/products/jaqueta?variant=4412345')).toBe(true);
    expect(unicaMensagem(pagina.mensagens)).toEqual({
      type: 'NOTIFY_WHEN_BACK',
      variantId: '4412345',
      path: '/products/jaqueta?variant=4412345',
    });
  });

  it('e sem caminho também: a variante basta', () => {
    const pagina = criarPagina();
    pagina.injetar();

    expect(pagina.api().notifyWhenBack(4412345)).toBe(false);
    expect(pagina.api().notifyWhenBack('4412345')).toBe(true);
    expect(unicaMensagem(pagina.mensagens)).toEqual({
      type: 'NOTIFY_WHEN_BACK',
      variantId: '4412345',
    });
  });

  /*
   * Caminho absoluto abriria OUTRO site dentro da aba, com a cara do app. O
   * bridge recusa do lado de cá também, e não só no schema: quem chama é o
   * tema do lojista.
   */
  it('caminho absoluto é descartado, e a mensagem sai sem ele', () => {
    const pagina = criarPagina();
    pagina.injetar();

    expect(pagina.api().notifyWhenBack('44', 'https://evil.com')).toBe(true);
    expect(unicaMensagem(pagina.mensagens)).toEqual({
      type: 'NOTIFY_WHEN_BACK',
      variantId: '44',
    });
  });

  it('pede permissão de push', () => {
    const pagina = criarPagina();
    pagina.injetar();
    expect(pagina.api().requestPushPermission()).toBe(true);
    expect(unicaMensagem(pagina.mensagens)).toEqual({ type: 'REQUEST_PUSH_PERMISSION' });
  });

  it('DEVOLVE FALSE fora do app, para o tema cair no comportamento web', () => {
    // A mesma página abre no Safari. Sem esse retorno, o botão de
    // compartilhar do tema não faria nada e ninguém saberia por quê.
    const pagina = criarPagina({ semCanal: true });
    pagina.injetar();
    const api = pagina.api();
    expect(api.share('https://oakvintage.com.br')).toBe(false);
    expect(api.haptic('light')).toBe(false);
    expect(api.openExternal('https://instagram.com/oakvintage')).toBe(false);
    expect(api.requestPushPermission()).toBe(false);
    expect(pagina.mensagens).toHaveLength(0);
  });

  it('não sobrescreve a si mesmo em nova navegação', () => {
    const pagina = criarPagina();
    pagina.injetar();
    const primeira = pagina.api().share;
    pagina.injetar();
    expect(pagina.api().share).toBe(primeira);
  });

  it('não quebra a página quando o canal explode', () => {
    const pagina = criarPagina();
    pagina.janela.ReactNativeWebView = {
      postMessage: (): never => {
        throw new Error('ponte caiu');
      },
    };
    pagina.injetar();
    expect(pagina.api().share('https://oakvintage.com.br')).toBe(false);
  });

  it('só manda mensagem que o próprio contrato aceita', () => {
    // Fecha o ciclo: o que a API produz passa por `lerMensagemDaWeb`, que é o
    // que a camada nativa usa do outro lado.
    const pagina = criarPagina();
    pagina.injetar();
    const api = pagina.api();
    api.share('https://oakvintage.com.br/p/1', 'Jaqueta');
    api.haptic('success');
    api.openExternal('https://instagram.com/oakvintage');
    api.requestPushPermission();

    expect(pagina.mensagens).toHaveLength(4);
    for (const bruta of pagina.mensagens) {
      expect(lerMensagemDaWeb(bruta).ok).toBe(true);
    }
  });
});

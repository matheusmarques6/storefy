/**
 * O banner rodando, como ele roda na vitrine do lojista.
 *
 * Este arquivo EXECUTA `extensions/storefy-tema/assets/storefy-banner.js` num
 * contexto do `node:vm` com um DOM falso, porque os defeitos que importam são
 * de comportamento e todos acontecem na loja de quem nos paga: aparecer dentro
 * do app, aparecer no computador, voltar depois de dispensado, ou estourar uma
 * exceção que o lojista vai ver como bug da loja dele.
 *
 * O arquivo é lido do disco de propósito: um teste sobre uma cópia provaria
 * que a cópia funciona.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const SCRIPT = readFileSync(
  resolve(import.meta.dirname, '../../../extensions/storefy-tema/assets/storefy-banner.js'),
  'utf8',
);

const API = 'https://app.storefy.com.br';
const LOJA = 'oak-vintage.myshopify.com';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  desktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
} as const;

const CONFIG_COMPLETA = {
  ativo: true,
  texto: 'Baixe o app da Oak Vintage',
  ios: 'https://apps.apple.com/app/id6478123456',
  android: 'https://play.google.com/store/apps/details?id=br.com.oakvintage.app',
  smartBanner: 'app-id=6478123456',
};

// ------------------------------------------------------------- o DOM falso

interface NoFalso {
  tag: string;
  id: string;
  name: string;
  content: string;
  href: string;
  rel: string;
  type: string;
  textContent: string;
  style: { cssText: string };
  filhos: NoFalso[];
  parentNode: NoFalso | null;
  atributos: Record<string, string>;
  ouvintes: Record<string, (() => void)[]>;
  setAttribute: (nome: string, valor: string) => void;
  getAttribute: (nome: string) => string | null;
  addEventListener: (evento: string, ouvinte: () => void) => void;
  appendChild: (filho: NoFalso) => void;
  removeChild: (filho: NoFalso) => void;
  clicar: () => void;
}

function criarNo(tag: string): NoFalso {
  const no: NoFalso = {
    tag,
    id: '',
    name: '',
    content: '',
    href: '',
    rel: '',
    type: '',
    textContent: '',
    style: { cssText: '' },
    filhos: [],
    parentNode: null,
    atributos: {},
    ouvintes: {},
    setAttribute(nome, valor) {
      no.atributos[nome] = valor;
    },
    getAttribute(nome) {
      return no.atributos[nome] ?? null;
    },
    addEventListener(evento, ouvinte) {
      (no.ouvintes[evento] ??= []).push(ouvinte);
    },
    appendChild(filho) {
      filho.parentNode = no;
      no.filhos.push(filho);
    },
    removeChild(filho) {
      no.filhos = no.filhos.filter((atual) => atual !== filho);
      filho.parentNode = null;
    },
    clicar() {
      for (const ouvinte of no.ouvintes.click ?? []) ouvinte();
    },
  };
  return no;
}

interface OpcoesDoAmbiente {
  ua?: string;
  /** O app está por volta? Então `window.__STOREFY__` existe. */
  dentroDoApp?: boolean;
  config?: unknown;
  /** A resposta do servidor falha. */
  semRede?: boolean;
  respostaOk?: boolean;
  /** Storage indisponível, como em navegação privada. */
  semStorage?: boolean;
  guardado?: Record<string, string>;
  toques?: number;
}

function criarAmbiente(opcoes: OpcoesDoAmbiente = {}) {
  const buscas: string[] = [];
  const guardado: Record<string, string> = { ...opcoes.guardado };
  const head = criarNo('head');
  const body = criarNo('body');

  const script = criarNo('script');
  script.setAttribute('data-storefy-loja', LOJA);
  script.setAttribute('data-storefy-api', API);

  const janela: Record<string, unknown> = {
    navigator: { userAgent: opcoes.ua ?? UA.iphone, maxTouchPoints: opcoes.toques ?? 5 },
    Number,
    Date,
    String,
    encodeURIComponent,
    localStorage: {
      getItem: (chave: string): string | null => {
        if (opcoes.semStorage === true) throw new Error('storage bloqueado');
        return guardado[chave] ?? null;
      },
      setItem: (chave: string, valor: string): void => {
        if (opcoes.semStorage === true) throw new Error('storage bloqueado');
        guardado[chave] = valor;
      },
    },
    fetch: (url: string): Promise<unknown> => {
      buscas.push(url);
      if (opcoes.semRede === true) return Promise.reject(new Error('sem rede'));
      return Promise.resolve({
        ok: opcoes.respostaOk ?? true,
        json: () => Promise.resolve(opcoes.config ?? CONFIG_COMPLETA),
      });
    },
    document: {
      head,
      body,
      documentElement: body,
      currentScript: script,
      createElement: (tag: string) => criarNo(tag),
      querySelector: () => script,
    },
  };
  if (opcoes.dentroDoApp === true) {
    janela.__STOREFY__ = { platform: 'ios', appVersion: '1.0.0', pushEnabled: true };
  }
  janela.window = janela;

  const contexto = createContext(janela);

  return {
    janela,
    buscas,
    guardado,
    head,
    body,
    rodar: (): void => {
      runInContext(SCRIPT, contexto);
    },
    escoar: async (): Promise<void> => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    },
    /** O nó do banner desenhado, ou `null`. */
    banner: (): NoFalso | null => body.filhos.find((no) => no.id === 'storefy-banner') ?? null,
    metaDoSafari: (): NoFalso | null =>
      head.filhos.find((no) => no.name === 'apple-itunes-app') ?? null,
  };
}

// ----------------------------------------------------------------- as guardas

describe('as guardas antes de qualquer coisa', () => {
  /*
   * Convidar a baixar o app quem JÁ ESTÁ no app é o tipo de detalhe que faz o
   * cliente duvidar do resto da loja.
   */
  it('dentro do app não aparece, e nem pergunta ao servidor', async () => {
    const ambiente = criarAmbiente({ dentroDoApp: true });
    ambiente.rodar();
    await ambiente.escoar();

    expect(ambiente.buscas).toEqual([]);
    expect(ambiente.banner()).toBeNull();
    expect(ambiente.metaDoSafari()).toBeNull();
  });

  /* No computador o link leva a uma loja de aplicativos de celular: beco sem saída. */
  it('no computador não aparece', async () => {
    const ambiente = criarAmbiente({ ua: UA.desktop, toques: 0 });
    ambiente.rodar();
    await ambiente.escoar();

    expect(ambiente.buscas).toEqual([]);
    expect(ambiente.banner()).toBeNull();
  });

  /* O iPad moderno se apresenta como Mac; o toque é o que o entrega. */
  it('mas no iPad, que se diz Mac, aparece', async () => {
    const ambiente = criarAmbiente({ ua: UA.desktop, toques: 5 });
    ambiente.rodar();
    await ambiente.escoar();

    expect(ambiente.buscas).toHaveLength(1);
  });

  it('rodar duas vezes não desenha dois banners', async () => {
    const ambiente = criarAmbiente({ ua: UA.android });
    ambiente.rodar();
    await ambiente.escoar();
    ambiente.rodar();
    await ambiente.escoar();

    expect(ambiente.body.filhos.filter((no) => no.id === 'storefy-banner')).toHaveLength(1);
    expect(ambiente.buscas).toHaveLength(1);
  });
});

describe('o que ele desenha', () => {
  /*
   * No iPhone o Safari desenha o convite NATIVO a partir da meta, com ícone,
   * nota e botão "abrir" quando o app já está instalado. Qualquer tarja nossa
   * por cima seria pior.
   */
  it('no iPhone entrega a meta do Safari e não desenha tarja', async () => {
    const ambiente = criarAmbiente({ ua: UA.iphone });
    ambiente.rodar();
    await ambiente.escoar();

    expect(ambiente.metaDoSafari()?.content).toBe('app-id=6478123456');
    expect(ambiente.banner()).toBeNull();
  });

  it('no Android desenha a tarja com o texto e o link da Play Store', async () => {
    const ambiente = criarAmbiente({ ua: UA.android });
    ambiente.rodar();
    await ambiente.escoar();

    const banner = ambiente.banner();
    expect(banner).not.toBeNull();
    expect(banner?.filhos[0]?.textContent).toBe('Baixe o app da Oak Vintage');
    expect(banner?.filhos[1]?.href).toBe(CONFIG_COMPLETA.android);
    // `rel=noopener`: sem ele a página da loja fica alcançável pela aba nova.
    expect(banner?.filhos[1]?.rel).toBe('noopener');
    expect(ambiente.metaDoSafari()).toBeNull();
  });

  it('e a tarja é anunciada para quem usa leitor de tela', async () => {
    const ambiente = criarAmbiente({ ua: UA.android });
    ambiente.rodar();
    await ambiente.escoar();

    const banner = ambiente.banner();
    expect(banner?.getAttribute('role')).toBe('region');
    expect(banner?.getAttribute('aria-label')).toContain('aplicativo');
    expect(banner?.filhos[2]?.getAttribute('aria-label')).toBe('Dispensar');
  });

  /*
   * Sem `env(safe-area-inset-bottom)` a tarja fica embaixo da barra de gestos
   * do iPhone e o botão não recebe o toque.
   */
  it('a tarja respeita a área segura do aparelho', async () => {
    const ambiente = criarAmbiente({ ua: UA.android });
    ambiente.rodar();
    await ambiente.escoar();

    expect(ambiente.banner()?.style.cssText).toContain('safe-area-inset-bottom');
  });

  /*
   * Com os links preenchidos, de propósito: o servidor nunca manda os dois
   * juntos, e é justamente por isso que a guarda daqui precisa de teste
   * próprio — senão ela some num refactor e ninguém percebe.
   */
  it('banner desligado não desenha nada, mesmo com os links vindo junto', async () => {
    const ambiente = criarAmbiente({
      ua: UA.android,
      config: { ...CONFIG_COMPLETA, ativo: false },
    });
    ambiente.rodar();
    await ambiente.escoar();

    expect(ambiente.banner()).toBeNull();
  });

  it('sem link para a plataforma do visitante, não desenha', async () => {
    const ambiente = criarAmbiente({
      ua: UA.android,
      config: { ...CONFIG_COMPLETA, android: null },
    });
    ambiente.rodar();
    await ambiente.escoar();

    expect(ambiente.banner()).toBeNull();
  });
});

describe('dispensar', () => {
  it('o × fecha a tarja e guarda a data', async () => {
    const ambiente = criarAmbiente({ ua: UA.android });
    ambiente.rodar();
    await ambiente.escoar();

    ambiente.banner()?.filhos[2]?.clicar();

    expect(ambiente.banner()).toBeNull();
    expect(Number(ambiente.guardado.storefy_banner_dispensado)).toBeGreaterThan(Date.now());
  });

  it('e dispensado não volta na página seguinte', async () => {
    const ambiente = criarAmbiente({
      ua: UA.android,
      guardado: { storefy_banner_dispensado: String(Date.now() + 86400000) },
    });
    ambiente.rodar();
    await ambiente.escoar();

    expect(ambiente.buscas).toEqual([]);
    expect(ambiente.banner()).toBeNull();
  });

  it('mas volta quando o prazo vence', async () => {
    const ambiente = criarAmbiente({
      ua: UA.android,
      guardado: { storefy_banner_dispensado: String(Date.now() - 1000) },
    });
    ambiente.rodar();
    await ambiente.escoar();

    expect(ambiente.banner()).not.toBeNull();
  });
});

describe('o que não pode quebrar a loja', () => {
  it('sem rede, a loja segue funcionando', async () => {
    const ambiente = criarAmbiente({ ua: UA.android, semRede: true });

    expect(() => {
      ambiente.rodar();
    }).not.toThrow();
    await ambiente.escoar();
    expect(ambiente.banner()).toBeNull();
  });

  it('resposta de erro do servidor não vira exceção', async () => {
    const ambiente = criarAmbiente({ ua: UA.android, respostaOk: false });
    ambiente.rodar();
    await ambiente.escoar();

    expect(ambiente.banner()).toBeNull();
  });

  /* Navegação privada bloqueia o storage; melhor mostrar do que estourar. */
  it('storage bloqueado não impede o banner', async () => {
    const ambiente = criarAmbiente({ ua: UA.android, semStorage: true });
    ambiente.rodar();
    await ambiente.escoar();

    expect(ambiente.banner()).not.toBeNull();
    // E o × continua fechando, mesmo sem conseguir lembrar disso.
    expect(() => {
      ambiente.banner()?.filhos[2]?.clicar();
    }).not.toThrow();
  });

  it('a URL consultada é a do bloco, com a loja escapada', async () => {
    const ambiente = criarAmbiente({ ua: UA.android });
    ambiente.rodar();
    await ambiente.escoar();

    expect(ambiente.buscas[0]).toBe(`${API}/api/public/banner/${LOJA}`);
  });
});

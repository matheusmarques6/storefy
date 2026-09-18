/**
 * Testes do observador de carrinho (seção 5.4 do plano).
 *
 * Conferir só a sintaxe do script não serviria de nada: ele roda dentro da
 * página do lojista e os defeitos que importam são de COMPORTAMENTO — laço
 * infinito ao ler `/cart.js`, injeção dobrada a cada navegação, promessa
 * devolvida trocada por outra, campo inventado numa resposta incompleta.
 *
 * Por isso cada teste daqui EXECUTA o script gerado num contexto do `node:vm`
 * com `window`, `fetch`, `XMLHttpRequest`, relógio e canal do app falsos, e
 * depois olha o que ele fez. O relógio é falso de propósito: com `setTimeout`
 * de verdade o teste ficaria lento e instável justamente na parte que mais
 * importa, a espera entre a mudança e a leitura.
 */
import { Script, createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { lerMensagemDaWeb, type WebToNative } from '@storefy/bridge';
import {
  CAMINHOS_DE_CARRINHO,
  MARCA_DE_INJECAO,
  ehMudancaDeCarrinho,
  gerarObservadorDeCarrinho,
} from './carrinho';

const BASE = 'https://oakvintage.com.br';
const PAGINA = `${BASE}/products/jaqueta-jeans-anos-90`;

/** Resposta de `/cart.js` com os quatro campos, como a Shopify devolve. */
const CARRINHO_CHEIO = {
  item_count: 3,
  token: 'c1-9f8e7d6c5b4a',
  total_price: 12990,
  currency: 'BRL',
};

// --------------------------------------------------------------- o ambiente

type Registro = Record<string, unknown>;

interface RespostaFalsa {
  json: () => Promise<unknown>;
}

type Buscar = (entrada: unknown, init?: unknown) => Promise<RespostaFalsa>;

interface Abertura {
  metodo: string;
  url: string;
  assincrono?: boolean;
}

interface OpcoesDoAmbiente {
  /** Corpo devolvido por `/cart.js`. */
  cartJs?: () => Promise<RespostaFalsa>;
  /** Trecho de URL cuja requisição falha. */
  falharEm?: string;
  /** WebView antiga, sem `fetch`. */
  semFetch?: boolean;
  /** Página sem `XMLHttpRequest`. */
  semXhr?: boolean;
  /** Página aberta fora do app: não existe canal para o nativo. */
  semCanal?: boolean;
}

function respostaCom(corpo: unknown): RespostaFalsa {
  return { json: () => Promise.resolve(corpo) };
}

/** `fetch` aceita string ou `Request`; o observador precisa entender os dois. */
function urlDaEntrada(entrada: unknown): string {
  if (typeof entrada === 'string') return entrada;
  if (entrada !== null && typeof entrada === 'object' && 'url' in entrada) {
    const { url } = entrada;
    if (typeof url === 'string') return url;
  }
  return '';
}

/**
 * Relógio controlado pelo teste.
 *
 * Os ids começam em 1 porque o script faz `if (pendente) clearTimeout(...)`:
 * com id 0 o cancelamento nunca aconteceria e o debounce passaria no teste sem
 * estar funcionando.
 */
function criarRelogio() {
  const tarefas = new Map<number, { quando: number; executar: () => void }>();
  let agora = 0;
  let proximoId = 1;

  return {
    marcar: (executar: () => void, ms: number): number => {
      const id = proximoId;
      proximoId += 1;
      tarefas.set(id, { quando: agora + ms, executar });
      return id;
    },
    cancelar: (id: number): void => {
      tarefas.delete(id);
    },
    avancar: (ms: number): void => {
      agora += ms;
      const prontas = [...tarefas.entries()]
        .filter(([, tarefa]) => tarefa.quando <= agora)
        .sort((a, b) => a[1].quando - b[1].quando);
      for (const [id, tarefa] of prontas) {
        tarefas.delete(id);
        tarefa.executar();
      }
    },
    pendentes: (): number => tarefas.size,
  };
}

/** Deixa as promessas já resolvidas rodarem antes da próxima asserção. */
async function escoar(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

function criarAmbiente(opcoes: OpcoesDoAmbiente = {}) {
  const mensagens: string[] = [];
  const urlsBuscadas: string[] = [];
  const aberturas: Abertura[] = [];
  const relogio = criarRelogio();
  const cartJs = opcoes.cartJs ?? (() => Promise.resolve(respostaCom(CARRINHO_CHEIO)));
  let ultimaPromessa: Promise<RespostaFalsa> | null = null;

  const buscar: Buscar = (entrada) => {
    const url = urlDaEntrada(entrada);
    urlsBuscadas.push(url);

    let promessa: Promise<RespostaFalsa>;
    if (opcoes.falharEm !== undefined && url.includes(opcoes.falharEm)) {
      promessa = Promise.reject(new Error('rede indisponível'));
    } else if (url.includes('/cart.js')) {
      promessa = cartJs();
    } else {
      promessa = Promise.resolve(respostaCom({}));
    }
    ultimaPromessa = promessa;
    return promessa;
  };

  class XhrFalso {
    private readonly ouvintes = new Map<string, (() => void)[]>();

    open(metodo: string, url: string, assincrono?: boolean): void {
      aberturas.push({ metodo, url, assincrono });
    }

    addEventListener(evento: string, ouvinte: () => void): void {
      const lista = this.ouvintes.get(evento) ?? [];
      lista.push(ouvinte);
      this.ouvintes.set(evento, lista);
    }

    disparar(evento: string): void {
      for (const ouvinte of this.ouvintes.get(evento) ?? []) ouvinte();
    }
  }

  const janela: Registro = {
    URL,
    location: { href: PAGINA },
    setTimeout: relogio.marcar,
    clearTimeout: relogio.cancelar,
  };
  if (opcoes.semFetch !== true) janela.fetch = buscar;
  if (opcoes.semXhr !== true) janela.XMLHttpRequest = XhrFalso;
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
    urlsBuscadas,
    aberturas,
    relogio,
    ultima: (): Promise<RespostaFalsa> | null => ultimaPromessa,
    injetar: (esperaMs?: number): void => {
      runInContext(gerarObservadorDeCarrinho(esperaMs === undefined ? {} : { esperaMs }), contexto);
    },
    /** Chama a `fetch` que a página enxerga — embrulhada, depois da injeção. */
    buscarPelaPagina: (entrada: unknown): Promise<RespostaFalsa> => {
      const executar = janela.fetch as Buscar | undefined;
      if (executar === undefined) throw new Error('a página não tem fetch');
      return executar(entrada);
    },
    novoXhr: (): XhrFalso => new XhrFalso(),
    escoar,
    avancarEEscoar: async (ms: number): Promise<void> => {
      await escoar();
      relogio.avancar(ms);
      await escoar();
    },
    zerar: (): void => {
      mensagens.length = 0;
      urlsBuscadas.length = 0;
      aberturas.length = 0;
    },
  };
}

/** A mensagem passou pelo contrato do bridge? Devolve já validada. */
function comoCartUpdated(texto: string): Extract<WebToNative, { type: 'CART_UPDATED' }> {
  const lido = lerMensagemDaWeb(texto);
  if (!lido.ok) throw new Error(`o bridge recusou a mensagem: ${lido.motivo}`);
  if (lido.mensagem.type !== 'CART_UPDATED') {
    throw new Error(`tipo inesperado: ${lido.mensagem.type}`);
  }
  return lido.mensagem;
}

function unica(lista: string[]): string {
  expect(lista).toHaveLength(1);
  const [primeira] = lista;
  if (primeira === undefined) throw new Error('nenhuma mensagem foi postada');
  return primeira;
}

// ------------------------------------------------------- ehMudancaDeCarrinho

describe('ehMudancaDeCarrinho', () => {
  it('reconhece os caminhos que mudam o carrinho, com e sem .js', () => {
    for (const caminho of CAMINHOS_DE_CARRINHO) {
      expect(ehMudancaDeCarrinho(caminho, BASE)).toBe(true);
      expect(ehMudancaDeCarrinho(`${caminho}.js`, BASE)).toBe(true);
    }
  });

  it('IGNORA /cart e /cart.js', () => {
    // `/cart` é a PÁGINA do carrinho e `/cart.js` é a nossa própria leitura.
    // Tratar qualquer um dos dois como mudança faria o app reler o carrinho a
    // cada visita à página — e, no caso de `/cart.js`, em laço infinito.
    expect(ehMudancaDeCarrinho('/cart', BASE)).toBe(false);
    expect(ehMudancaDeCarrinho('/cart/', BASE)).toBe(false);
    expect(ehMudancaDeCarrinho('/cart.js', BASE)).toBe(false);
    expect(ehMudancaDeCarrinho('/carts/add', BASE)).toBe(false);
    expect(ehMudancaDeCarrinho('/cart/addons', BASE)).toBe(false);
  });

  it('normaliza barra final, maiúsculas e query', () => {
    expect(ehMudancaDeCarrinho('/cart/add/', BASE)).toBe(true);
    expect(ehMudancaDeCarrinho('/CART/ADD.JS', BASE)).toBe(true);
    expect(ehMudancaDeCarrinho('/cart/change.js?quantity=2', BASE)).toBe(true);
    expect(ehMudancaDeCarrinho('/cart/update.js#topo', BASE)).toBe(true);
  });

  it('aceita URL absoluta', () => {
    expect(ehMudancaDeCarrinho(`${BASE}/cart/add.js`, BASE)).toBe(true);
    // A decisão é pelo caminho, não pelo domínio: um falso positivo custa uma
    // leitura de `/cart.js` a mais, já com espera; um falso negativo custa um
    // badge errado na tela do cliente.
    expect(ehMudancaDeCarrinho('https://outro-dominio.com/cart/add.js', BASE)).toBe(true);
  });

  it('devolve false em vez de estourar quando a base não presta', () => {
    expect(ehMudancaDeCarrinho('/cart/add.js', 'isto-não-é-uma-url')).toBe(false);
    expect(ehMudancaDeCarrinho('', 'isto-não-é-uma-url')).toBe(false);
  });
});

// ------------------------------------------------------------ script gerado

describe('gerarObservadorDeCarrinho', () => {
  it('gera JavaScript sintaticamente válido', () => {
    expect(() => new Script(gerarObservadorDeCarrinho())).not.toThrow();
    expect(() => new Script(gerarObservadorDeCarrinho({ esperaMs: 50 }))).not.toThrow();
  });

  it('termina em `true;`, como a injeção do iOS exige', () => {
    // Sem isso, o WebView do iOS avisa no console a cada navegação.
    expect(gerarObservadorDeCarrinho().trimEnd().endsWith('true;')).toBe(true);
  });
});

// ------------------------------------------------------ observador rodando

describe('observador em execução', () => {
  it('lê o carrinho assim que é injetado e manda uma mensagem do contrato', async () => {
    const ambiente = criarAmbiente();
    ambiente.injetar();
    await ambiente.escoar();

    expect(ambiente.urlsBuscadas).toEqual(['/cart.js']);
    const mensagem = comoCartUpdated(unica(ambiente.mensagens));
    expect(mensagem).toEqual({
      type: 'CART_UPDATED',
      count: 3,
      token: 'c1-9f8e7d6c5b4a',
      totalCents: 12990,
      currency: 'BRL',
    });
  });

  it('a leitura de /cart.js NÃO dispara o observador de novo', async () => {
    // Este é o laço infinito que derruba a loja: se a `fetch` original fosse
    // capturada depois do embrulho, ler `/cart.js` passaria pelo observador,
    // que leria `/cart.js` de novo, sem fim.
    const ambiente = criarAmbiente();
    ambiente.injetar();
    await ambiente.avancarEEscoar(5000);

    expect(ambiente.urlsBuscadas).toEqual(['/cart.js']);
    expect(ambiente.mensagens).toHaveLength(1);
    expect(ambiente.relogio.pendentes()).toBe(0);
  });

  it('uma chamada de /cart/add.js gera uma leitura depois da espera', async () => {
    const ambiente = criarAmbiente();
    ambiente.injetar(300);
    await ambiente.escoar();
    ambiente.zerar();

    await ambiente.buscarPelaPagina('/cart/add.js');
    await ambiente.escoar();
    expect(ambiente.urlsBuscadas).toEqual(['/cart/add.js']);

    // Antes da espera terminar, nada ainda.
    await ambiente.avancarEEscoar(299);
    expect(ambiente.mensagens).toHaveLength(0);

    await ambiente.avancarEEscoar(1);
    expect(ambiente.urlsBuscadas).toEqual(['/cart/add.js', '/cart.js']);
    expect(comoCartUpdated(unica(ambiente.mensagens)).count).toBe(3);
  });

  it('várias chamadas seguidas viram UMA leitura só', async () => {
    // Um clique em "adicionar" dispara adicionar, recalcular frete e recarregar
    // a gaveta. Sem debounce seriam três leituras e três mensagens.
    const ambiente = criarAmbiente();
    ambiente.injetar(300);
    await ambiente.escoar();
    ambiente.zerar();

    await ambiente.buscarPelaPagina('/cart/add.js');
    await ambiente.avancarEEscoar(100);
    await ambiente.buscarPelaPagina('/cart/update.js');
    await ambiente.avancarEEscoar(100);
    await ambiente.buscarPelaPagina('/cart/change.js');
    await ambiente.avancarEEscoar(300);

    expect(ambiente.urlsBuscadas).toEqual([
      '/cart/add.js',
      '/cart/update.js',
      '/cart/change.js',
      '/cart.js',
    ]);
    expect(ambiente.mensagens).toHaveLength(1);
  });

  it('devolve exatamente a promessa que a fetch original devolveu', async () => {
    // O tema encadeia `.then` no retorno da `fetch`. Devolver outra promessa
    // — ou o resultado já resolvido — quebraria a loja.
    const ambiente = criarAmbiente();
    ambiente.injetar();
    await ambiente.escoar();

    const devolvida = ambiente.buscarPelaPagina('/cart/add.js');
    expect(devolvida).toBe(ambiente.ultima());
    await devolvida;
  });

  it('propaga a rejeição e não mexe no badge quando o add falha', async () => {
    const ambiente = criarAmbiente({ falharEm: '/cart/add' });
    ambiente.injetar(300);
    await ambiente.escoar();
    ambiente.zerar();

    await expect(ambiente.buscarPelaPagina('/cart/add.js')).rejects.toThrow('rede indisponível');
    await ambiente.avancarEEscoar(300);

    // O carrinho não mudou, então não há o que reler.
    expect(ambiente.urlsBuscadas).toEqual(['/cart/add.js']);
    expect(ambiente.mensagens).toHaveLength(0);
  });

  it('não reage a requisição que não é de carrinho', async () => {
    const ambiente = criarAmbiente();
    ambiente.injetar(300);
    await ambiente.escoar();
    ambiente.zerar();

    await ambiente.buscarPelaPagina('/products/jaqueta.js');
    await ambiente.buscarPelaPagina('https://cdn.shopify.com/s/files/1/theme.js');
    await ambiente.avancarEEscoar(300);

    expect(ambiente.urlsBuscadas).toEqual([
      '/products/jaqueta.js',
      'https://cdn.shopify.com/s/files/1/theme.js',
    ]);
    expect(ambiente.mensagens).toHaveLength(0);
  });

  it('entende fetch(Request) além de fetch(string)', async () => {
    // Tema moderno costuma montar um `Request` antes de chamar.
    const ambiente = criarAmbiente();
    ambiente.injetar(300);
    await ambiente.escoar();
    ambiente.zerar();

    await ambiente.buscarPelaPagina({ url: `${BASE}/cart/add.js`, method: 'POST' });
    await ambiente.avancarEEscoar(300);

    expect(ambiente.mensagens).toHaveLength(1);
  });

  it('acompanha XMLHttpRequest sem atrapalhar a chamada original', async () => {
    const ambiente = criarAmbiente();
    ambiente.injetar(300);
    await ambiente.escoar();
    ambiente.zerar();

    const xhr = ambiente.novoXhr();
    xhr.open('POST', '/cart/add.js', true);
    expect(ambiente.aberturas).toEqual([{ metodo: 'POST', url: '/cart/add.js', assincrono: true }]);

    xhr.disparar('load');
    await ambiente.avancarEEscoar(300);
    expect(ambiente.urlsBuscadas).toEqual(['/cart.js']);
    expect(ambiente.mensagens).toHaveLength(1);
  });

  it('XHR que não é de carrinho não dispara leitura', async () => {
    const ambiente = criarAmbiente();
    ambiente.injetar(300);
    await ambiente.escoar();
    ambiente.zerar();

    const xhr = ambiente.novoXhr();
    xhr.open('GET', '/search/suggest.json', true);
    xhr.disparar('load');
    await ambiente.avancarEEscoar(300);

    expect(ambiente.urlsBuscadas).toHaveLength(0);
    expect(ambiente.mensagens).toHaveLength(0);
  });

  it('marca o window e recusa a segunda injeção', async () => {
    // Cada navegação roda a injeção de novo; embrulhar o embrulho duplicaria
    // toda requisição da loja.
    const ambiente = criarAmbiente();
    ambiente.injetar(300);
    await ambiente.escoar();
    expect(ambiente.janela[MARCA_DE_INJECAO]).toBe(true);

    const embrulhoInicial = ambiente.janela.fetch;
    ambiente.injetar(300);
    await ambiente.escoar();

    expect(ambiente.janela.fetch).toBe(embrulhoInicial);
    expect(ambiente.urlsBuscadas).toEqual(['/cart.js']);
    expect(ambiente.mensagens).toHaveLength(1);

    ambiente.zerar();
    await ambiente.buscarPelaPagina('/cart/add.js');
    await ambiente.avancarEEscoar(300);
    expect(ambiente.urlsBuscadas).toEqual(['/cart/add.js', '/cart.js']);
  });
});

// ----------------------------------------------- páginas fora do figurino

describe('observador diante de página hostil', () => {
  it('não quebra nem posta quando a página não tem fetch', async () => {
    const ambiente = criarAmbiente({ semFetch: true });
    expect(() => {
      ambiente.injetar();
    }).not.toThrow();
    await ambiente.avancarEEscoar(1000);
    expect(ambiente.mensagens).toHaveLength(0);
  });

  it('não quebra quando a página não tem XMLHttpRequest', async () => {
    const ambiente = criarAmbiente({ semXhr: true });
    ambiente.injetar();
    await ambiente.escoar();
    expect(ambiente.mensagens).toHaveLength(1);
  });

  it('não quebra quando não existe canal para o nativo', async () => {
    // A mesma página abre no Safari, fora do app: `ReactNativeWebView` não
    // existe e o script não pode gerar erro no console do lojista.
    const ambiente = criarAmbiente({ semCanal: true });
    ambiente.injetar(300);
    await ambiente.escoar();
    await ambiente.buscarPelaPagina('/cart/add.js');
    await ambiente.avancarEEscoar(300);
    expect(ambiente.urlsBuscadas).toEqual(['/cart.js', '/cart/add.js', '/cart.js']);
  });

  it('engole a falha de rede ao ler /cart.js', async () => {
    const ambiente = criarAmbiente({ falharEm: '/cart.js' });
    ambiente.injetar();
    await ambiente.avancarEEscoar(1000);
    expect(ambiente.mensagens).toHaveLength(0);
  });

  it('engole resposta que não é JSON', async () => {
    const ambiente = criarAmbiente({
      cartJs: () => Promise.resolve({ json: () => Promise.reject(new Error('HTML, não JSON')) }),
    });
    ambiente.injetar();
    await ambiente.avancarEEscoar(1000);
    expect(ambiente.mensagens).toHaveLength(0);
  });

  it('engole corpo nulo', async () => {
    const ambiente = criarAmbiente({ cartJs: () => Promise.resolve(respostaCom(null)) });
    ambiente.injetar();
    await ambiente.escoar();
    expect(ambiente.mensagens).toHaveLength(0);
  });
});

// ------------------------------------------------- regra 1: nada inventado

describe('observador diante de /cart.js incompleto', () => {
  it('NÃO posta quando não veio item_count', async () => {
    // Postar `count: 0` zeraria o badge de um carrinho que pode estar cheio.
    const ambiente = criarAmbiente({
      cartJs: () => Promise.resolve(respostaCom({ token: 'abc', currency: 'BRL' })),
    });
    ambiente.injetar();
    await ambiente.escoar();
    expect(ambiente.mensagens).toHaveLength(0);
  });

  it('NÃO posta quando item_count não é inteiro não negativo', async () => {
    for (const valor of ['3', -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      const ambiente = criarAmbiente({
        cartJs: () => Promise.resolve(respostaCom({ item_count: valor })),
      });
      ambiente.injetar();
      await ambiente.escoar();
      expect(ambiente.mensagens).toHaveLength(0);
    }
  });

  it('manda só a contagem quando o resto não veio, em vez de inventar', async () => {
    // Dizer `currency: 'BRL'` para uma loja em dólar, ou `totalCents: 0` para
    // um carrinho cheio, seria dado falso em `cart_events` (regra 1).
    const ambiente = criarAmbiente({
      cartJs: () => Promise.resolve(respostaCom({ item_count: 2 })),
    });
    ambiente.injetar();
    await ambiente.escoar();

    const mensagem = comoCartUpdated(unica(ambiente.mensagens));
    expect(mensagem).toEqual({ type: 'CART_UPDATED', count: 2 });
  });

  it('descarta campo presente mas inválido e mantém a mensagem válida', async () => {
    const ambiente = criarAmbiente({
      cartJs: () =>
        Promise.resolve(
          respostaCom({
            item_count: 1,
            token: '',
            total_price: 10.5,
            currency: 'REAIS',
          }),
        ),
    });
    ambiente.injetar();
    await ambiente.escoar();

    const mensagem = comoCartUpdated(unica(ambiente.mensagens));
    expect(mensagem).toEqual({ type: 'CART_UPDATED', count: 1 });
  });

  it('aceita carrinho vazio com token', async () => {
    const ambiente = criarAmbiente({
      cartJs: () =>
        Promise.resolve(
          respostaCom({ item_count: 0, token: 'vazio-1', total_price: 0, currency: 'USD' }),
        ),
    });
    ambiente.injetar();
    await ambiente.escoar();

    expect(comoCartUpdated(unica(ambiente.mensagens))).toEqual({
      type: 'CART_UPDATED',
      count: 0,
      token: 'vazio-1',
      totalCents: 0,
      currency: 'USD',
    });
  });
});

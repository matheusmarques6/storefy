/**
 * Testes da marca de atribuição (seção 8 do plano).
 *
 * Mesma régua do observador de carrinho: conferir a sintaxe do script não
 * serviria de nada, porque os defeitos que importam são de COMPORTAMENTO —
 * gravar em toda página vista, gravar em laço, embrulhar o `fetch` da loja e
 * devolver outra promessa, marcar onde não há carrinho. Cada teste EXECUTA o
 * script gerado num contexto do `node:vm` com `window`, `fetch`,
 * `XMLHttpRequest` e relógio falsos, e depois olha o que ele fez.
 *
 * O que está em jogo é o número que sustenta a assinatura: se a marca não for
 * gravada, todo pedido feito pelo app aparece como pedido do site.
 */
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { gerarObservadorDeCarrinho } from './carrinho';
import {
  ATRIBUTO_DO_CARRINHO,
  MARCA_DE_INJECAO,
  VALOR_DO_ATRIBUTO,
  ehPaginaDoCarrinho,
  gerarMarcaDoApp,
} from './atribuicao';

const BASE = 'https://oakvintage.com.br';
const PRODUTO = `${BASE}/products/jaqueta-jeans-anos-90`;
const CARRINHO = `${BASE}/cart`;

type Registro = Record<string, unknown>;

interface Chamada {
  url: string;
  metodo: string;
  corpo: unknown;
}

function criarRelogio() {
  const tarefas = new Map<number, { quando: number; executar: () => void }>();
  let agora = 0;
  // Começa em 1: o script faz `if(pendente)clearTimeout(...)`, e com id 0 o
  // cancelamento nunca aconteceria — o debounce passaria sem estar de pé.
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
      for (const [id, tarefa] of [...tarefas.entries()].sort((a, b) => a[1].quando - b[1].quando)) {
        if (tarefa.quando > agora) continue;
        tarefas.delete(id);
        tarefa.executar();
      }
    },
  };
}

async function escoar(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

interface OpcoesDoAmbiente {
  /** Caminho da página aberta. */
  pagina?: string;
  /** Trecho de URL cuja requisição falha. */
  falharEm?: string;
  /** WebView antiga, sem `fetch`. */
  semFetch?: boolean;
  semXhr?: boolean;
}

function criarAmbiente(opcoes: OpcoesDoAmbiente = {}) {
  const chamadas: Chamada[] = [];
  const relogio = criarRelogio();
  const pagina = opcoes.pagina ?? PRODUTO;
  let ultimaPromessa: Promise<Registro> | null = null;

  const buscar = (entrada: unknown, init?: Registro): Promise<Registro> => {
    const url =
      typeof entrada === 'string'
        ? entrada
        : entrada !== null && typeof entrada === 'object' && 'url' in entrada
          ? String(entrada.url)
          : '';

    chamadas.push({
      url,
      metodo: typeof init?.method === 'string' ? init.method : 'GET',
      corpo: init?.body,
    });

    const promessa =
      opcoes.falharEm !== undefined && url.includes(opcoes.falharEm)
        ? Promise.reject(new Error('rede indisponível'))
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ item_count: 1 }) });

    ultimaPromessa = promessa;
    return promessa;
  };

  class XhrFalso {
    private readonly ouvintes = new Map<string, (() => void)[]>();
    open(_metodo: string, _url: string): void {
      // Sobrescrito pelo script; o corpo original não precisa fazer nada.
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
    location: { href: pagina, pathname: new URL(pagina).pathname },
    setTimeout: relogio.marcar,
    clearTimeout: relogio.cancelar,
  };
  if (opcoes.semFetch !== true) janela.fetch = buscar;
  if (opcoes.semXhr !== true) janela.XMLHttpRequest = XhrFalso;
  janela.ReactNativeWebView = { postMessage: (): void => undefined };
  janela.window = janela;

  const contexto = createContext(janela);

  return {
    janela,
    chamadas,
    injetar: (esperaMs?: number): void => {
      runInContext(gerarMarcaDoApp(esperaMs === undefined ? {} : { esperaMs }), contexto);
    },
    /** Chama a `fetch` que a página enxerga — embrulhada, depois da injeção. */
    buscarPelaPagina: (url: string): Promise<unknown> => {
      const executar = janela.fetch as ((entrada: unknown) => Promise<unknown>) | undefined;
      if (executar === undefined) throw new Error('a página não tem fetch');
      return executar(url);
    },
    novoXhr: (): XhrFalso => new XhrFalso(),
    /** A promessa que a loja recebeu de volta, para conferir identidade. */
    ultima: (): Promise<Registro> | null => ultimaPromessa,
    /** Injeta também o observador de carrinho, na ordem real do app. */
    injetarObservador: (): void => {
      runInContext(gerarObservadorDeCarrinho(), contexto);
    },
    leiturasDoCarrinho: (): Chamada[] => chamadas.filter((c) => c.url.includes('/cart.js')),
    avancarEEscoar: async (ms: number): Promise<void> => {
      await escoar();
      relogio.avancar(ms);
      await escoar();
    },
    /**
     * Só as gravações NOSSAS.
     *
     * Filtrar por `/cart/update.js` não basta: o tema do lojista também chama
     * esse endpoint, e contá-lo faria o teste do debounce acusar uma gravação
     * que nunca existiu. O que identifica a nossa é o atributo no corpo.
     */
    marcacoes: (): Chamada[] =>
      chamadas.filter(
        (c) =>
          c.url.includes('/cart/update.js') &&
          c.metodo === 'POST' &&
          String(c.corpo).includes(ATRIBUTO_DO_CARRINHO),
      ),
  };
}

describe('ehPaginaDoCarrinho', () => {
  it('reconhece a página do carrinho, com e sem barra no fim', () => {
    expect(ehPaginaDoCarrinho('/cart', BASE)).toBe(true);
    expect(ehPaginaDoCarrinho('/cart/', BASE)).toBe(true);
    expect(ehPaginaDoCarrinho(`${BASE}/cart`, BASE)).toBe(true);
    expect(ehPaginaDoCarrinho('/CART', BASE)).toBe(true);
  });

  /* A Shopify prefixa o caminho no mercado internacional. */
  it('reconhece o carrinho com prefixo de idioma', () => {
    expect(ehPaginaDoCarrinho('/pt-br/cart', BASE)).toBe(true);
    expect(ehPaginaDoCarrinho('/en/cart', BASE)).toBe(true);
  });

  /*
   * `/cart.js` e `/cart/add.js` são API, não página. Tratá-las como página
   * faria a marcação disparar em cima da interceptação, duas vezes pelo mesmo
   * motivo.
   */
  it('não confunde a API do carrinho com a página', () => {
    for (const caminho of ['/cart.js', '/cart/add.js', '/cart/update.js', '/cart/change']) {
      expect(ehPaginaDoCarrinho(caminho, BASE), caminho).toBe(false);
    }
  });

  it('nem uma coleção que começa igual', () => {
    expect(ehPaginaDoCarrinho('/collections/cart-bags', BASE)).toBe(false);
    expect(ehPaginaDoCarrinho('/carteiras', BASE)).toBe(false);
  });

  it('url quebrada não vira página do carrinho', () => {
    expect(ehPaginaDoCarrinho('http://[', BASE)).toBe(false);
  });
});

describe('gerarMarcaDoApp', () => {
  /*
   * O atributo tem que ser EXATAMENTE o que o webhook procura. Uma letra
   * diferente e todo pedido do app vira pedido do site, sem erro em lugar
   * nenhum.
   */
  it('grava o atributo que o webhook procura, e só depois da mudança', async () => {
    const ambiente = criarAmbiente();
    ambiente.injetar();

    // Nada acontece só por abrir uma página de produto.
    await ambiente.avancarEEscoar(1000);
    expect(ambiente.marcacoes()).toHaveLength(0);

    await ambiente.buscarPelaPagina('/cart/add.js');
    await ambiente.avancarEEscoar(500);

    const [marcacao] = ambiente.marcacoes();
    expect(marcacao?.metodo).toBe('POST');
    expect(marcacao?.url).toBe('/cart/update.js');
    expect(JSON.parse(String(marcacao?.corpo))).toEqual({
      attributes: { [ATRIBUTO_DO_CARRINHO]: VALOR_DO_ATRIBUTO },
    });
  });

  it('o atributo começa com underscore, que é o que a Shopify esconde do cliente', () => {
    expect(ATRIBUTO_DO_CARRINHO.startsWith('_')).toBe(true);
  });

  /*
   * Um clique em "adicionar" dispara várias chamadas seguidas. Sem debounce
   * seriam três gravações na loja do cliente para uma ação só.
   */
  it('várias mudanças seguidas gravam uma vez só', async () => {
    const ambiente = criarAmbiente();
    ambiente.injetar();

    await ambiente.buscarPelaPagina('/cart/add.js');
    await ambiente.buscarPelaPagina('/cart/change.js');
    await ambiente.buscarPelaPagina('/cart/update.js');
    await ambiente.avancarEEscoar(500);

    expect(ambiente.marcacoes()).toHaveLength(1);
  });

  /*
   * O atributo fica no carrinho até ele virar pedido. Repetir não acrescenta
   * nada e gasta requisição da loja de quem nos paga.
   */
  it('não regrava depois de já ter marcado', async () => {
    const ambiente = criarAmbiente();
    ambiente.injetar();

    await ambiente.buscarPelaPagina('/cart/add.js');
    await ambiente.avancarEEscoar(500);
    await ambiente.buscarPelaPagina('/cart/add.js');
    await ambiente.avancarEEscoar(500);

    expect(ambiente.marcacoes()).toHaveLength(1);
  });

  /*
   * A gravação usa o `fetch` ORIGINAL. Pelo embrulhado, `/cart/update.js`
   * seria vista como mudança de carrinho e agendaria outra gravação, em laço.
   */
  it('a própria gravação não dispara outra', async () => {
    const ambiente = criarAmbiente();
    ambiente.injetar();

    await ambiente.buscarPelaPagina('/cart/add.js');
    for (let volta = 0; volta < 5; volta += 1) await ambiente.avancarEEscoar(500);

    expect(ambiente.marcacoes()).toHaveLength(1);
  });

  /* O tema que adiciona por formulário navega, e a interceptação não vê nada. */
  it('a página do carrinho marca sozinha, sem depender de interceptação', async () => {
    const ambiente = criarAmbiente({ pagina: CARRINHO });
    ambiente.injetar();
    await ambiente.avancarEEscoar(0);

    expect(ambiente.marcacoes()).toHaveLength(1);
  });

  it('a página de produto não marca sozinha', async () => {
    const ambiente = criarAmbiente({ pagina: PRODUTO });
    ambiente.injetar();
    await ambiente.avancarEEscoar(1000);

    expect(ambiente.marcacoes()).toHaveLength(0);
  });

  it('o XMLHttpRequest do tema também conta como mudança', async () => {
    const ambiente = criarAmbiente();
    ambiente.injetar();

    const xhr = ambiente.novoXhr();
    (
      ambiente.janela.XMLHttpRequest as { prototype: { open: (m: string, u: string) => void } }
    ).prototype.open.call(xhr, 'POST', '/cart/add.js');
    xhr.disparar('load');
    await ambiente.avancarEEscoar(500);

    expect(ambiente.marcacoes()).toHaveLength(1);
  });

  /*
   * O script roda dentro da loja do cliente: ele NÃO PODE quebrá-la. A
   * promessa devolvida tem que ser a mesma da função original, inclusive na
   * rejeição — trocá-la faz o tema quebrar ao tratar o próprio erro.
   */
  it('devolve a promessa da loja, inclusive quando ela falha', async () => {
    const ambiente = criarAmbiente({ falharEm: '/cart/add.js' });
    ambiente.injetar();

    await expect(ambiente.buscarPelaPagina('/cart/add.js')).rejects.toThrow('rede indisponível');
    // E uma chamada que falhou não vira marcação.
    await ambiente.avancarEEscoar(500);
    expect(ambiente.marcacoes()).toHaveLength(0);
  });

  /* Gravação que falha pode ser tentada de novo: o carrinho ficou sem marca. */
  it('gravação que falhou é tentada na mudança seguinte', async () => {
    const ambiente = criarAmbiente({ falharEm: '/cart/update.js' });
    ambiente.injetar();

    await ambiente.buscarPelaPagina('/cart/add.js');
    await ambiente.avancarEEscoar(500);
    await ambiente.buscarPelaPagina('/cart/add.js');
    await ambiente.avancarEEscoar(500);

    expect(ambiente.marcacoes()).toHaveLength(2);
  });

  /* Cada navegação roda a injeção de novo; embrulhar o embrulho multiplicaria. */
  it('injetar duas vezes não embrulha duas vezes', async () => {
    const ambiente = criarAmbiente();
    ambiente.injetar();
    const depoisDaPrimeira = ambiente.janela.fetch;
    ambiente.injetar();

    expect(ambiente.janela.fetch).toBe(depoisDaPrimeira);
    expect(ambiente.janela[MARCA_DE_INJECAO]).toBe(true);

    await ambiente.buscarPelaPagina('/cart/add.js');
    await ambiente.avancarEEscoar(500);
    expect(ambiente.marcacoes()).toHaveLength(1);
  });

  it('WebView sem fetch não quebra a página', () => {
    const ambiente = criarAmbiente({ semFetch: true });

    expect(() => {
      ambiente.injetar();
    }).not.toThrow();
  });

  it('página sem XMLHttpRequest também não', () => {
    const ambiente = criarAmbiente({ semXhr: true });

    expect(() => {
      ambiente.injetar();
    }).not.toThrow();
  });

  /*
   * A espera não é enfeite: gravar enquanto o `/cart/add.js` do tema ainda
   * está no ar faz a Shopify responder a ELE um carrinho de antes da nossa
   * escrita, e a gaveta abre com o número errado.
   */
  it('não grava antes da espera terminar', async () => {
    const ambiente = criarAmbiente();
    ambiente.injetar(400);

    await ambiente.buscarPelaPagina('/cart/add.js');
    await ambiente.avancarEEscoar(100);
    expect(ambiente.marcacoes()).toHaveLength(0);

    await ambiente.avancarEEscoar(400);
    expect(ambiente.marcacoes()).toHaveLength(1);
  });

  /*
   * Identidade, e não "resolve igual": a loja pode comparar a promessa, e
   * devolver outra com o mesmo valor já quebrou tema de verdade.
   */
  it('devolve a MESMA promessa que a loja receberia', async () => {
    const ambiente = criarAmbiente();
    ambiente.injetar();

    const devolvida = ambiente.buscarPelaPagina('/cart/add.js');
    expect(devolvida).toBe(ambiente.ultima());
    await devolvida;
  });

  /*
   * Com o observador de carrinho junto, como roda no app de verdade. A marca é
   * injetada ANTES, então ela grava com o `fetch` original e o observador não
   * vê a gravação — se visse, cada marcação custaria uma leitura de `/cart.js`
   * a mais na loja do cliente.
   */
  it('a gravação não acorda o observador de carrinho', async () => {
    const ambiente = criarAmbiente();
    ambiente.injetar();
    ambiente.injetarObservador();

    // O observador lê uma vez ao ser injetado; o que interessa é o depois.
    await ambiente.avancarEEscoar(500);
    const antes = ambiente.leiturasDoCarrinho().length;

    await ambiente.buscarPelaPagina('/cart/add.js');
    await ambiente.avancarEEscoar(500);
    await ambiente.avancarEEscoar(500);

    expect(ambiente.marcacoes()).toHaveLength(1);
    // Uma leitura só: a que o próprio `/cart/add.js` provocou.
    expect(ambiente.leiturasDoCarrinho().length - antes).toBe(1);
  });

  /* No iOS, um retorno não serializável derruba a injeção sem aviso nenhum. */
  it('o script termina em true', () => {
    expect(gerarMarcaDoApp().trimEnd().endsWith('true;')).toBe(true);
  });
});

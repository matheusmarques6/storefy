// @vitest-environment happy-dom

/**
 * O seletor visual é EXECUTADO aqui, num DOM de verdade.
 *
 * O que importa neste script não é a sintaxe: é qual seletor sai quando o
 * lojista clica no cabeçalho do tema dele. Um seletor que muda a cada build do
 * tema — `div > div:nth-child(7)`, uma classe com hash — deixaria de esconder o
 * que ele escolheu, sem aviso nenhum, semanas depois.
 */
import { runInThisContext } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';
import { MARCA_DA_PREVIA, gerarScriptDaPrevia } from '@/lib/preview-proxy';

/** Cabeçalho e rodapé como um tema de Shopify entrega. */
const PAGINA = `
  <header class="site-header header--has-menu sticky">
    <a class="site-header__logo" href="/">Oak Vintage</a>
    <nav class="site-nav"><a href="/novidades">Novidades</a></nav>
  </header>
  <main id="MainContent">
    <div class="banner css-1x2y3z"><p class="banner__texto">Frete grátis</p></div>
    <ul class="grade">
      <li class="produto"><span>A</span></li>
      <li class="produto"><span>B</span></li>
      <li class="produto"><span>C</span></li>
      <li class="produto"><span>D</span></li>
    </ul>
  </main>
  <footer class="site-footer"><p>Rodapé</p></footer>
`;

const escolhidos: string[] = [];

function ligarSelecao(selecionando: boolean): void {
  window.dispatchEvent(
    new window.MessageEvent('message', {
      data: { fonte: MARCA_DA_PREVIA, tipo: 'modo', selecionando },
    }),
  );
}

function clicar(seletor: string): void {
  const alvo = document.querySelector(seletor);
  if (alvo === null) throw new Error(`não achei ${seletor} na página de teste`);
  alvo.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.innerHTML = PAGINA;
  // O `<head>` guarda os estilos que o script injeta; sem limpar, um caso
  // herdaria o estilo do anterior e passaria por engano.
  document.head.innerHTML = '';
  escolhidos.length = 0;

  // O script fala com o pai por postMessage; aqui o pai é a própria janela.
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: {
      postMessage: (dados: unknown) => {
        const carga = dados as { fonte?: string; tipo?: string; seletor?: string };
        if (
          carga.fonte === MARCA_DA_PREVIA &&
          carga.tipo === 'escolhido' &&
          carga.seletor != null
        ) {
          escolhidos.push(carga.seletor);
        }
      },
    },
  });

  /*
   * `runInThisContext` e não uma tag `<script>`: o happy-dom do vitest anexa a
   * tag e NÃO executa o conteúdo, e o teste passaria sem testar nada. Rodando
   * no contexto atual, o script enxerga os mesmos `window` e `document` que as
   * asserções abaixo — que é exatamente a situação dentro do iframe.
   */
  runInThisContext(gerarScriptDaPrevia());

  // O script recusa a segunda injeção, então os ouvintes ficam registrados
  // para o arquivo inteiro. O modo é zerado aqui, como estaria numa página
  // recém-carregada.
  ligarSelecao(false);
});

describe('modo de seleção', () => {
  it('não escolhe nada enquanto está desligado', () => {
    // Senão o lojista não conseguiria navegar na prévia sem esconder coisas.
    clicar('header');
    expect(escolhidos).toEqual([]);
  });

  it('escolhe o cabeçalho por classe, e não por posição', () => {
    ligarSelecao(true);
    clicar('header');
    expect(escolhidos).toEqual(['header.site-header']);
  });

  it('para de escolher quando o modo é desligado', () => {
    ligarSelecao(true);
    ligarSelecao(false);
    clicar('footer');
    expect(escolhidos).toEqual([]);
  });

  it('o seletor escolhido encontra o elemento clicado', () => {
    // É a garantia que importa: o que vai para `hideSelectors` precisa mesmo
    // esconder o que o lojista apontou.
    ligarSelecao(true);
    for (const alvo of ['header', 'footer', '.site-nav', '#MainContent', '.banner__texto']) {
      escolhidos.length = 0;
      clicar(alvo);
      const seletor = escolhidos[0];
      expect(seletor, alvo).toBeDefined();
      const encontrado = document.querySelector(String(seletor));
      expect(encontrado, `${alvo} -> ${String(seletor)}`).toBe(document.querySelector(alvo));
    }
  });

  it('usa o id quando ele existe e é estável', () => {
    ligarSelecao(true);
    clicar('#MainContent');
    expect(escolhidos).toEqual(['#MainContent']);
  });

  it('DESCARTA classe com hash, que muda a cada build do tema', () => {
    // `css-1x2y3z` some no próximo deploy do lojista, e o que ele escondeu
    // volta a aparecer sem ninguém entender por quê.
    ligarSelecao(true);
    clicar('.banner');
    expect(escolhidos[0]).toBe('div.banner');
    expect(escolhidos[0]).not.toContain('1x2y3z');
  });

  it('desce até o ancestral quando o elemento sozinho não distingue', () => {
    ligarSelecao(true);
    clicar('.banner__texto');
    const seletor = String(escolhidos[0]);
    expect(document.querySelectorAll(seletor)).toHaveLength(1);
  });

  it('não devolve seletor que pegaria a página inteira', () => {
    ligarSelecao(true);
    clicar('.grade li:nth-child(2) span');
    const seletor = String(escolhidos[0]);
    expect(seletor).not.toBe('span');
    expect(seletor).not.toBe('div');
    expect(document.querySelectorAll(seletor).length).toBeLessThanOrEqual(4);
  });

  it('o clique no modo de seleção não navega', () => {
    // Um clique no logo levaria a prévia para outra página no meio da escolha.
    ligarSelecao(true);
    const link = document.querySelector('.site-header__logo');
    const evento = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    link?.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(true);
  });

  it('clique fora do modo de seleção navega normalmente', () => {
    const link = document.querySelector('.site-header__logo');
    const evento = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    link?.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(false);
  });
});

describe('css ao vivo', () => {
  it('aplica o que o painel manda sem recarregar a loja', () => {
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: { fonte: MARCA_DA_PREVIA, tipo: 'css', css: 'header{display:none !important;}' },
      }),
    );
    const estilo = document.getElementById(`${MARCA_DA_PREVIA}-ao-vivo`);
    expect(estilo?.textContent).toBe('header{display:none !important;}');
  });

  it('substitui o estilo anterior em vez de empilhar', () => {
    for (const css of ['header{display:none}', 'footer{display:none}']) {
      window.dispatchEvent(
        new window.MessageEvent('message', { data: { fonte: MARCA_DA_PREVIA, tipo: 'css', css } }),
      );
    }
    expect(document.querySelectorAll(`#${MARCA_DA_PREVIA}-ao-vivo`)).toHaveLength(1);
    expect(document.getElementById(`${MARCA_DA_PREVIA}-ao-vivo`)?.textContent).toBe(
      'footer{display:none}',
    );
  });

  it('IGNORA mensagem de outra origem', () => {
    // Qualquer página pode mandar postMessage para um iframe.
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: { fonte: 'outro-app', tipo: 'css', css: 'body{display:none}' },
      }),
    );
    expect(document.getElementById(`${MARCA_DA_PREVIA}-ao-vivo`)).toBeNull();
  });

  it('não quebra com mensagem malformada', () => {
    for (const data of [null, undefined, 'texto', 42, [], { fonte: MARCA_DA_PREVIA }]) {
      expect(() => {
        window.dispatchEvent(new window.MessageEvent('message', { data }));
      }).not.toThrow();
    }
  });
});

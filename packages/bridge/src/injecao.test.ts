import { Script, createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ID_DO_ESTILO, comoLiteralJs, gerarCss, gerarInjecao } from './injecao';
import { lerMensagemDaWeb } from './mensagens';

/**
 * O código é sintaticamente válido?
 *
 * `new Script` do `node:vm` compila sem executar, então verifica a sintaxe sem
 * rodar nada — ao contrário de `new Function`, que constrói uma função
 * executável e é `no-implied-eval` com razão.
 */
function compila(codigo: string): void {
  new Script(codigo);
}

const contexto = { platform: 'ios' as const, appVersion: '1.0.0', pushEnabled: true };

describe('gerarCss', () => {
  it('emite UMA regra por seletor', () => {
    // Em lista separada por vírgula, um seletor inválido faz o navegador
    // descartar a regra inteira e nada mais é escondido.
    const css = gerarCss({ hideSelectors: ['header', '.site-footer'], customCss: '' });
    expect(css).toBe('header{display:none !important;}\n.site-footer{display:none !important;}');
  });

  it('um seletor quebrado não derruba os outros', () => {
    const css = gerarCss({
      hideSelectors: ['header', '', '   ', '.rodape'],
      customCss: '',
    });
    expect(css).toContain('header{display:none !important;}');
    expect(css).toContain('.rodape{display:none !important;}');
    expect(css.split('\n')).toHaveLength(2);
  });

  it('recusa seletor com chave, que viraria bloco de CSS livre', () => {
    // O campo promete "esconder elementos"; aceitar chaves deixaria escrever
    // qualquer CSS por uma porta que não anuncia isso.
    const css = gerarCss({
      hideSelectors: ['header', 'body{display:block}', '.x'],
      customCss: '',
    });
    expect(css).not.toContain('body{display:block}');
    expect(css.split('\n')).toHaveLength(2);
  });

  it('recusa regra em arroba disfarçada de seletor', () => {
    const css = gerarCss({ hideSelectors: ['@media print'], customCss: '' });
    expect(css).toBe('');
  });

  it('acrescenta o CSS do lojista no fim, para poder sobrescrever', () => {
    const css = gerarCss({
      hideSelectors: ['header'],
      customCss: 'body { padding-top: 0; }',
    });
    expect(css.endsWith('body { padding-top: 0; }')).toBe(true);
  });

  it('devolve vazio quando não há nada a aplicar', () => {
    expect(gerarCss({ hideSelectors: [], customCss: '   ' })).toBe('');
  });
});

describe('comoLiteralJs', () => {
  it('escapa aspas e barras', () => {
    expect(comoLiteralJs(`a"b\\c`)).toBe('"a\\"b\\\\c"');
  });

  it('escapa `<`, para sobreviver dentro de um script em HTML', () => {
    const saida = comoLiteralJs('</script><script>alert(1)</script>');
    expect(saida).not.toContain('</script>');
    expect(saida).toContain('\\u003c');
  });

  it('escapa os separadores de linha do JavaScript', () => {
    // U+2028 e U+2029 são quebra de linha para o parser de JS, mas não para o
    // JSON: sem escapar, o script injetado quebra na metade.
    const saida = comoLiteralJs('a\u2028b\u2029c');
    expect(saida).toContain('\\u2028');
    expect(saida).toContain('\\u2029');
    expect(saida).not.toMatch(/[\u2028\u2029]/);
  });
});

describe('gerarInjecao', () => {
  it('termina em `true;`', () => {
    // Sem isso, o retorno da última expressão volta para a ponte nativa e no
    // iOS um valor não serializável derruba a injeção sem aviso visível.
    const script = gerarInjecao({ hideSelectors: [], customCss: '', contexto });
    expect(script.endsWith('true;')).toBe(true);
  });

  it('define o contexto antes de qualquer outra coisa', () => {
    const script = gerarInjecao({ hideSelectors: ['header'], customCss: '', contexto });
    expect(script.indexOf('__STOREFY__')).toBeLessThan(script.indexOf('createElement'));
  });

  it('entrega o contexto do app à página', () => {
    const script = gerarInjecao({ hideSelectors: [], customCss: '', contexto });
    expect(script).toContain('"platform":"ios"');
    expect(script).toContain('"appVersion":"1.0.0"');
    expect(script).toContain('"pushEnabled":true');
  });

  it('usa documentElement quando head ainda não existe', () => {
    // Injetado antes do conteúdo, `document.head` pode ser nulo.
    const script = gerarInjecao({ hideSelectors: ['header'], customCss: '', contexto });
    expect(script).toContain('document.head||document.documentElement');
  });

  it('não duplica o estilo em nova navegação', () => {
    const script = gerarInjecao({ hideSelectors: ['header'], customCss: '', contexto });
    expect(script).toContain('getElementById');
    expect(script).toContain(ID_DO_ESTILO);
  });

  it('não cria o estilo quando não há CSS', () => {
    const script = gerarInjecao({ hideSelectors: [], customCss: '', contexto });
    expect(script).not.toContain('createElement');
  });

  it('CSS com aspas do lojista não quebra o script', () => {
    const script = gerarInjecao({
      hideSelectors: [],
      customCss: `.x::after{content:"aspas ' e \\" aqui";}`,
      contexto,
    });
    // Se o escape falhasse, isto lançaria SyntaxError.
    expect(() => {
      compila(script);
    }).not.toThrow();
  });

  it('bloqueia o zoom quando pedido', () => {
    const script = gerarInjecao({
      hideSelectors: [],
      customCss: '',
      contexto,
      bloquearZoom: true,
    });
    expect(script).toContain('user-scalable=no');
    expect(script).toContain('viewport-fit=cover');
  });

  it('não mexe no viewport quando não pedido', () => {
    const script = gerarInjecao({ hideSelectors: [], customCss: '', contexto });
    expect(script).not.toContain('user-scalable');
  });

  it('isola o JavaScript do lojista, para o erro dele não levar o resto', () => {
    const script = gerarInjecao({
      hideSelectors: ['header'],
      customCss: '',
      contexto,
      customJs: 'naoExiste.metodo()',
    });
    expect(script).toContain('naoExiste.metodo()');
    // Dois try/catch: um para o nosso bloco, outro para o do lojista.
    expect(script.match(/try\{/g)?.length).toBe(2);
  });

  it('o script gerado é sintaticamente válido em todos os modos', () => {
    for (const opcoes of [
      { hideSelectors: [], customCss: '', contexto },
      { hideSelectors: ['header', '.x'], customCss: 'body{margin:0}', contexto },
      { hideSelectors: ['header'], customCss: '', contexto, bloquearZoom: true },
      { hideSelectors: [], customCss: '', contexto, customJs: 'console.info(1)' },
      { hideSelectors: [], customCss: '', contexto, compartilharNativo: true, customJs: 'x()' },
    ]) {
      expect(() => {
        compila(gerarInjecao(opcoes));
      }).not.toThrow();
    }
  });
});

/*
 * O compartilhar RODA aqui, num contexto do `node:vm`: o que importa é o que
 * o botão do tema recebe de volta e a mensagem que chega ao app.
 */
describe('navigator.share pela ponte', () => {
  const PAGINA = 'https://oakvintage.com.br/products/jaqueta';

  interface Navegador {
    share?: (dados?: unknown) => Promise<void>;
    canShare?: (dados?: unknown) => boolean;
  }

  function montar(opcoes: { navegador?: Navegador; semCanal?: boolean } = {}) {
    const mensagens: unknown[] = [];
    const navegador: Navegador = opcoes.navegador ?? {};
    const janela: Record<string, unknown> = {
      navigator: navegador,
      location: { href: PAGINA },
      URL,
    };
    if (opcoes.semCanal !== true) {
      janela.ReactNativeWebView = {
        postMessage: (texto: string): void => {
          const lida = lerMensagemDaWeb(texto);
          if (!lida.ok) throw new Error(`o contrato recusou: ${lida.motivo}`);
          mensagens.push(lida.mensagem);
        },
      };
    }
    janela.window = janela;
    runInContext(
      gerarInjecao({ hideSelectors: [], customCss: '', contexto, compartilharNativo: true }),
      createContext(janela),
    );
    return { navegador, mensagens };
  }

  it('instala share e canShare onde o sistema não tem', () => {
    const { navegador } = montar();
    expect(typeof navegador.share).toBe('function');
    expect(typeof navegador.canShare).toBe('function');
  });

  it('o botão do tema compartilha o produto pela folha nativa', async () => {
    const { navegador, mensagens } = montar();
    await expect(
      navegador.share?.({ url: '/products/jaqueta?variant=1', title: ' Jaqueta jeans ' }),
    ).resolves.toBeUndefined();
    expect(mensagens).toEqual([
      {
        type: 'SHARE',
        url: 'https://oakvintage.com.br/products/jaqueta?variant=1',
        title: 'Jaqueta jeans',
      },
    ]);
  });

  it('sem endereço, compartilha a página atual; o texto vira título', async () => {
    const { navegador, mensagens } = montar();
    await navegador.share?.({ text: 'Olha isto' });
    expect(mensagens).toEqual([{ type: 'SHARE', url: PAGINA, title: 'Olha isto' }]);
  });

  it('recusa endereço que não é http(s), como a especificação manda', async () => {
    const { navegador, mensagens } = montar();
    await expect(navegador.share?.({ url: 'javascript:alert(1)' })).rejects.toHaveProperty(
      'name',
      'TypeError',
    );
    expect(mensagens).toEqual([]);
  });

  it('não finge ter compartilhado fora do app', async () => {
    const { navegador } = montar({ semCanal: true });
    await expect(navegador.share?.({ url: PAGINA })).rejects.toHaveProperty('name', 'Error');
  });

  it('deixa a do sistema quando ela existe', () => {
    const doSistema = (): Promise<void> => Promise.resolve();
    const { navegador } = montar({ navegador: { share: doSistema } });
    expect(navegador.share).toBe(doSistema);
    expect(navegador.canShare).toBeUndefined();
  });

  it('canShare diz não a arquivo, que a ponte não carrega', () => {
    const { navegador } = montar();
    expect(navegador.canShare?.({ url: PAGINA })).toBe(true);
    expect(navegador.canShare?.({ files: [{}] })).toBe(false);
    expect(navegador.canShare?.()).toBe(true);
  });

  it('só entra quando pedido', () => {
    expect(gerarInjecao({ hideSelectors: [], customCss: '', contexto })).not.toContain('share');
  });
});

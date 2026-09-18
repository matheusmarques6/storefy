import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ID_DO_ESTILO, comoLiteralJs, gerarCss, gerarInjecao } from './injecao';

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
    ]) {
      expect(() => {
        compila(gerarInjecao(opcoes));
      }).not.toThrow();
    }
  });
});

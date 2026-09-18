/**
 * JavaScript injetado na WebView antes de a página carregar (seção 5.4).
 *
 * É o que transforma o site em app: esconde o cabeçalho e o rodapé do tema,
 * aplica o CSS do lojista e entrega o contexto do app à página.
 *
 * POR QUE ANTES DO CONTEÚDO: rodando depois, o cabeçalho do tema aparece por
 * uma fração de segundo e some. Esse pisca é a diferença mais visível entre
 * "site dentro de um app" e app de verdade.
 *
 * UMA REGRA POR SELETOR, e não uma lista separada por vírgula. O navegador
 * descarta a regra INTEIRA quando um seletor da lista é inválido — bastaria o
 * lojista digitar `.header,,` para nada mais ser escondido, sem nenhum aviso.
 * Separadas, um seletor quebrado custa só a si mesmo.
 */

export interface OpcoesDeInjecao {
  /** Seletores a esconder, vindos de `webview.hideSelectors`. */
  hideSelectors: readonly string[];
  /** CSS livre do lojista, de `webview.customCss`. */
  customCss: string;
  /** JavaScript livre do lojista, de `webview.customJs`. */
  customJs?: string;
  /** Contexto entregue à página em `window.__STOREFY__`. */
  contexto: {
    platform: 'ios' | 'android';
    appVersion: string;
    pushEnabled: boolean;
  };
  /** Desativa o zoom por pinça, via meta viewport (seção 5.4). */
  bloquearZoom?: boolean;
}

/** Identificador do nosso `<style>`, para não duplicar em nova navegação. */
export const ID_DO_ESTILO = 'storefy-estilo';

/** Seletor vazio ou que não é seletor não deve virar regra. */
function seletorValido(seletor: string): boolean {
  const limpo = seletor.trim();
  if (limpo === '') return false;
  // Chaves transformariam o seletor em bloco e deixariam o lojista escrever
  // CSS arbitrário por um campo que promete só esconder elementos.
  if (limpo.includes('{') || limpo.includes('}')) return false;
  // `@media` e afins não são seletores.
  if (limpo.startsWith('@')) return false;
  return true;
}

/** Monta o CSS final: uma regra por seletor, mais o CSS do lojista. */
export function gerarCss(opcoes: Pick<OpcoesDeInjecao, 'hideSelectors' | 'customCss'>): string {
  const regras = opcoes.hideSelectors
    .filter(seletorValido)
    .map((seletor) => `${seletor.trim()}{display:none !important;}`);

  const custom = opcoes.customCss.trim();
  if (custom !== '') regras.push(custom);

  return regras.join('\n');
}

/**
 * Texto seguro para embutir dentro de um literal JavaScript.
 *
 * `JSON.stringify` já cuida de aspas, quebras de linha e barras invertidas.
 * O escape extra de `<` cobre o caso de esta string acabar dentro de um
 * `<script>` em HTML, onde um `</script>` no meio do conteúdo fecharia a tag
 * antes da hora — e o `U+2028`/`U+2029`, que são quebras de linha para o
 * parser de JavaScript mas não para o JSON.
 */
export function comoLiteralJs(valor: string): string {
  return JSON.stringify(valor)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * O script completo para `injectedJavaScriptBeforeContentLoaded`.
 *
 * Termina em `true;`: sem isso, o valor da última expressão volta para a ponte
 * nativa, e no iOS um retorno não serializável derruba a injeção com um aviso
 * que não aparece em lugar nenhum.
 */
export function gerarInjecao(opcoes: OpcoesDeInjecao): string {
  const css = gerarCss(opcoes);
  const contexto = JSON.stringify(opcoes.contexto);

  const partes: string[] = [
    '(function(){try{',
    // O contexto vem primeiro: um erro no CSS não pode impedir a página de
    // saber que está dentro do app.
    `window.__STOREFY__=${contexto};`,
  ];

  if (css !== '') {
    partes.push(
      `var raiz=document.head||document.documentElement;`,
      `if(raiz&&!document.getElementById(${comoLiteralJs(ID_DO_ESTILO)})){`,
      `var e=document.createElement('style');`,
      `e.id=${comoLiteralJs(ID_DO_ESTILO)};`,
      `e.textContent=${comoLiteralJs(css)};`,
      `raiz.appendChild(e);}`,
    );
  }

  if (opcoes.bloquearZoom === true) {
    partes.push(
      `var v=document.querySelector('meta[name="viewport"]');`,
      `if(!v){v=document.createElement('meta');v.name='viewport';`,
      `(document.head||document.documentElement).appendChild(v);}`,
      `v.content='width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';`,
    );
  }

  const custom = opcoes.customJs?.trim() ?? '';
  if (custom !== '') {
    // Em bloco próprio: um erro no JavaScript do lojista não pode impedir o
    // CSS nem o contexto de serem aplicados.
    partes.push(`}catch(erro){}try{`, custom, ';');
  }

  partes.push('}catch(erro){}})();true;');
  return partes.join('');
}

/**
 * Script injetado que observa o carrinho (seção 5.4 do plano).
 *
 * A Shopify não avisa ninguém quando o carrinho muda: o tema chama
 * `/cart/add.js` por conta própria e atualiza o DOM. Para o badge da aba
 * acompanhar, o jeito é interceptar `fetch` e `XMLHttpRequest`, perceber as
 * chamadas de carrinho e, depois delas, ler `/cart.js` — que é a única fonte
 * confiável do total, já que a resposta de `/cart/add.js` traz só o item
 * adicionado.
 *
 * O script roda dentro da página do lojista, então ele NÃO PODE quebrá-la:
 *
 *   - guarda o `fetch` original antes de embrulhar, senão a própria leitura de
 *     `/cart.js` dispararia o observador de novo, em laço infinito;
 *   - devolve exatamente o que a função original devolveu, incluindo rejeição,
 *     senão o tema quebra ao tratar o próprio erro;
 *   - não injeta duas vezes, porque cada navegação roda a injeção de novo e
 *     embrulhar o embrulho multiplica as chamadas;
 *   - engole os próprios erros: uma exceção nossa não pode aparecer como bug
 *     da loja.
 *
 * E nunca completa o que `/cart.js` não disse. Quem responde ali é o tema do
 * lojista, com proxy, cache de borda e apps de terceiro no caminho; se um campo
 * não vier, o script omite. Dizer `currency: 'BRL'` para uma loja em dólar ou
 * `totalCents: 0` para um carrinho cheio seria dado falso gravado em
 * `cart_events` (regra 1 do CLAUDE.md). Sem `item_count` não há mensagem: é o
 * número do badge, e é a única coisa que `CART_UPDATED` exige.
 */

/** Caminhos que mudam o carrinho na Shopify. */
export const CAMINHOS_DE_CARRINHO = [
  '/cart/add',
  '/cart/change',
  '/cart/update',
  '/cart/clear',
] as const;

/** Marca no `window` que impede injeção dupla. */
export const MARCA_DE_INJECAO = '__STOREFY_CARRINHO__';

export interface OpcoesDoObservador {
  /**
   * Espera antes de ler `/cart.js`, em milissegundos.
   *
   * Um clique em "adicionar" costuma disparar várias chamadas seguidas
   * (adicionar, depois atualizar frete, depois recarregar a gaveta). Sem
   * espera, seriam três leituras e três mensagens para uma ação só.
   */
  esperaMs?: number;
}

/**
 * O caminho corresponde a uma mudança de carrinho?
 *
 * Exportado separado porque é a regra que erra na prática: `/cart` sozinho é a
 * PÁGINA do carrinho, não uma mudança, e tratá-la como mudança faria o app
 * reler o carrinho a cada visita à página. `/cart.js` também fica de fora: é a
 * leitura que o próprio observador faz, e aceitá-la seria laço infinito.
 *
 * A decisão é pelo caminho, não pelo domínio. Os endpoints de carrinho da
 * Shopify são sempre da própria loja, mas o tema pode estar em `www.` e a
 * config em domínio apex; comparar origem criaria falso negativo justamente
 * onde dói. Um falso positivo custa uma leitura de `/cart.js` a mais, já com
 * espera; um falso negativo custa um badge errado na tela do cliente.
 */
export function ehMudancaDeCarrinho(url: string, base: string): boolean {
  let caminho: string;
  try {
    caminho = new URL(url, base).pathname.toLowerCase().replace(/\/+$/, '');
  } catch {
    return false;
  }

  return CAMINHOS_DE_CARRINHO.some((alvo) => caminho === alvo || caminho === `${alvo}.js`);
}

/** O script completo, pronto para `injectedJavaScript`. */
export function gerarObservadorDeCarrinho(opcoes: OpcoesDoObservador = {}): string {
  const espera = opcoes.esperaMs ?? 300;
  const caminhos = JSON.stringify(CAMINHOS_DE_CARRINHO);

  return `(function(){
try{
if(window.${MARCA_DE_INJECAO})return;
window.${MARCA_DE_INJECAO}=true;

var CAMINHOS=${caminhos};
var fetchOriginal=window.fetch?window.fetch.bind(window):null;
var abrirOriginal=window.XMLHttpRequest?window.XMLHttpRequest.prototype.open:null;
var pendente=null;

function ehCarrinho(url){
try{
var c=new URL(String(url),location.href).pathname.toLowerCase().replace(/\\/+$/,'');
for(var i=0;i<CAMINHOS.length;i++){if(c===CAMINHOS[i]||c===CAMINHOS[i]+'.js')return true;}
return false;
}catch(e){return false;}
}

function postar(carga){
try{
if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){
window.ReactNativeWebView.postMessage(JSON.stringify(carga));
}
}catch(e){}
}

function inteiro(v){
return typeof v==='number'&&isFinite(v)&&v>=0&&Math.floor(v)===v;
}

function lerCarrinho(){
if(!fetchOriginal)return;
fetchOriginal('/cart.js',{credentials:'same-origin',headers:{'Accept':'application/json'}})
.then(function(r){return r.json();})
.then(function(c){
if(!c||!inteiro(c.item_count))return;
var carga={type:'CART_UPDATED',count:c.item_count};
if(typeof c.token==='string'&&c.token)carga.token=c.token;
if(inteiro(c.total_price))carga.totalCents=c.total_price;
if(typeof c.currency==='string'&&c.currency.length===3)carga.currency=c.currency;
postar(carga);
})
.catch(function(){});
}

function agendar(){
if(pendente)clearTimeout(pendente);
pendente=setTimeout(function(){pendente=null;lerCarrinho();},${String(espera)});
}

if(fetchOriginal){
window.fetch=function(entrada,opcoes){
var alvo=typeof entrada==='string'?entrada:(entrada&&entrada.url)||'';
var resposta=fetchOriginal(entrada,opcoes);
try{if(ehCarrinho(alvo)){resposta.then(function(){agendar();},function(){});}}catch(e){}
return resposta;
};
}

if(abrirOriginal){
window.XMLHttpRequest.prototype.open=function(metodo,url){
try{if(ehCarrinho(url)){this.addEventListener('load',function(){agendar();});}}catch(e){}
return abrirOriginal.apply(this,arguments);
};
}

lerCarrinho();
}catch(e){}
})();true;`;
}

/**
 * A marca que diz "este pedido veio do app" (seção 8 do plano).
 *
 * É o começo da corrente que responde a pergunta que sustenta a assinatura —
 * "o app me deu quanto de receita a mais". O app grava o atributo `_storefy`
 * no carrinho; a Shopify carrega o atributo até o pedido; o webhook
 * `orders/create` o lê e grava `source = 'app'`. Sem este arquivo, a corrente
 * não tem primeiro elo e o painel não tem o que mostrar.
 *
 * POR QUE ATRIBUTO DE CARRINHO, E NÃO JANELA DE TEMPO: uma regra de "comprou
 * até 30 minutos depois de abrir o app" erra toda vez que o cliente abre o
 * app, desiste, e compra pelo site meia hora depois — e erra sempre A FAVOR do
 * app, que é o pior tipo de erro num número que o lojista usa para decidir se
 * continua pagando.
 *
 * O underscore na frente não é estilo: a Shopify ESCONDE do cliente final os
 * atributos que começam com `_`. Sem ele, "_storefy: 1" apareceria no e-mail
 * de confirmação e na página de agradecimento da loja.
 *
 * QUANDO A MARCA É GRAVADA, e por quê só nesses dois momentos:
 *
 *   depois de uma mudança de carrinho — é quando existe um carrinho que pode
 *   virar pedido, e é o caminho por onde quase todo mundo passa;
 *   ao abrir a página do carrinho — cobre o tema que adiciona por formulário
 *   em vez de `fetch`, onde a página navega e a interceptação não vê nada.
 *
 * Em nenhuma outra página. Marcar em toda abertura criaria um carrinho vazio
 * na loja do cliente para cada visitante que só passou os olhos, e seria um
 * POST por página vista na loja de quem nos paga.
 */

/*
 * O atributo vem de `@storefy/config-schema`, que é o contrato painel ⇄ app.
 * Uma cópia aqui e outra no webhook se desencontrariam no dia em que alguém
 * renomeasse uma delas — e o sintoma seria todo pedido do app aparecendo como
 * pedido do site, sem erro em lugar nenhum.
 */
import {
  ATRIBUTO_DO_CARRINHO,
  ATRIBUTO_DO_PUSH,
  JANELA_DO_PUSH_MS,
  VALOR_DO_ATRIBUTO,
  valorDoAtributoDoPush,
  type ToqueNoPush,
} from '@storefy/config-schema';

export { ATRIBUTO_DO_CARRINHO, ATRIBUTO_DO_PUSH, VALOR_DO_ATRIBUTO };

/** Marca no `window` que impede injeção dupla a cada navegação. */
export const MARCA_DE_INJECAO = '__STOREFY_ATRIBUICAO__';

/**
 * Onde a página encontra o toque na notificação: `window.__STOREFY_PUSH__`.
 *
 * Uma variável da página, e não um valor fixo dentro do script, porque o
 * toque acontece com a loja JÁ aberta: o app atualiza a variável em cada aba
 * carregada, e a próxima mudança de carrinho já sai com a origem nova. Com o
 * valor fixo no script, uma aba aberta antes do toque gravaria por cima a
 * origem velha — e a venda iria para a notificação errada.
 */
export const GLOBAL_DO_PUSH = '__STOREFY_PUSH__';

/** O que a página precisa saber do toque: o valor do atributo e até quando ele vale. */
export interface MarcaDoPush {
  valor: string;
  /** Epoch em ms. Depois disso, a página para de gravar o atributo. */
  expiraEm: number;
}

/**
 * O toque, pronto para a página. `null` sem toque ou com o toque vencido.
 *
 * A janela é conferida aqui e de novo na página, na hora de gravar: a aba
 * pode ficar aberta dias, e o toque vence com ela aberta.
 */
export function marcaDoToque(toque: ToqueNoPush | null, agoraMs: number): MarcaDoPush | null {
  if (toque === null) return null;
  const expiraEm = toque.tocadaEmMs + JANELA_DO_PUSH_MS;
  if (agoraMs > expiraEm) return null;
  return { valor: valorDoAtributoDoPush(toque), expiraEm };
}

/**
 * A linha que põe o toque na página. Vai no começo do script injetado a cada
 * carga e, quando o cliente toca numa notificação com a loja aberta, sozinha,
 * em cada aba já carregada.
 */
export function gerarAtualizacaoDoPush(marca: MarcaDoPush | null): string {
  return `try{window.${GLOBAL_DO_PUSH}=${JSON.stringify(marca)};}catch(e){}true;`;
}

/**
 * A página é a do carrinho?
 *
 * Exportada separada porque é a regra que erra na prática. `/cart` e
 * `/cart/` são a página; `/cart.js` e `/cart/add.js` são chamadas de API, e
 * tratá-las como página faria a marcação disparar em cima da interceptação,
 * duas vezes pelo mesmo motivo. `/collections/cart-bags` começa com as mesmas
 * letras e não tem nada a ver.
 */
export function ehPaginaDoCarrinho(url: string, base: string): boolean {
  let caminho: string;
  try {
    caminho = new URL(url, base).pathname.toLowerCase().replace(/\/+$/, '');
  } catch {
    return false;
  }

  // `/pt-br/cart` e `/en/cart`: a Shopify prefixa o caminho no mercado
  // internacional, e a loja brasileira que vende para fora cai aí.
  return caminho === '/cart' || /^\/[a-z]{2}(-[a-z]{2})?\/cart$/.test(caminho);
}

export interface OpcoesDaMarca {
  /**
   * Espera antes de gravar, em milissegundos.
   *
   * Não é debounce — quem garante uma gravação só é a trava `gravado`. A
   * espera existe para não disputar o carrinho com o tema: gravar enquanto o
   * `/cart/add.js` dele ainda está no ar faz a Shopify responder ao tema um
   * carrinho de antes da nossa escrita, e a gaveta abre com o número errado.
   */
  esperaMs?: number;
}

/**
 * O script, pronto para `injectedJavaScript`.
 *
 * Roda dentro da loja do cliente, então vale a mesma régua do observador de
 * carrinho: guarda o `fetch` original antes de embrulhar, devolve exatamente o
 * que a função original devolveu, não injeta duas vezes e engole os próprios
 * erros. Um problema nosso não pode aparecer como bug da loja.
 */
export function gerarMarcaDoApp(opcoes: OpcoesDaMarca = {}): string {
  const espera = opcoes.esperaMs ?? 400;

  return `(function(){
try{
if(window.${MARCA_DE_INJECAO})return;
window.${MARCA_DE_INJECAO}=true;

var CAMINHOS=["/cart/add","/cart/change","/cart/update","/cart/clear"];
var fetchOriginal=window.fetch?window.fetch.bind(window):null;
var abrirOriginal=window.XMLHttpRequest?window.XMLHttpRequest.prototype.open:null;
/* O corpo da última gravação. Trava por CONTEÚDO, e não por página: um toque
 * numa notificação com a página aberta muda o corpo, e a mudança seguinte do
 * carrinho grava de novo, agora com a origem do push. */
var gravado=null;

/*
 * A marca do app sempre; a origem do push só enquanto o toque vale. Sem toque
 * válido o atributo do push NÃO vai — nem vazio: apagá-lo aqui apagaria a
 * origem que outra aba, carregada depois do toque, acabou de gravar. O
 * atributo velho que fica no carrinho o webhook recusa pela hora do toque.
 */
function corpo(){
var atributos={};
atributos[${JSON.stringify(ATRIBUTO_DO_CARRINHO)}]=${JSON.stringify(VALOR_DO_ATRIBUTO)};
try{
var p=window.${GLOBAL_DO_PUSH};
if(p&&typeof p.valor==='string'&&typeof p.expiraEm==='number'&&Date.now()<=p.expiraEm){
atributos[${JSON.stringify(ATRIBUTO_DO_PUSH)}]=p.valor;
}
}catch(e){}
return JSON.stringify({attributes:atributos});
}

function ehMudanca(url){
try{
var c=new URL(String(url),location.href).pathname.toLowerCase().replace(/\\/+$/,'');
for(var i=0;i<CAMINHOS.length;i++){if(c===CAMINHOS[i]||c===CAMINHOS[i]+'.js')return true;}
return false;
}catch(e){return false;}
}

function ehPaginaDoCarrinho(){
try{
var c=location.pathname.toLowerCase().replace(/\\/+$/,'');
return c==='/cart'||/^\\/[a-z]{2}(-[a-z]{2})?\\/cart$/.test(c);
}catch(e){return false;}
}

/*
 * Uma gravação por conteúdo. O atributo fica no carrinho até ele virar
 * pedido, então repetir o mesmo corpo não acrescenta nada e só gasta
 * requisição da loja do cliente.
 *
 * Usa o \`fetch\` ORIGINAL de propósito: \`/cart/update.js\` é uma mudança de
 * carrinho, e passar pelo embrulhado faria a própria gravação agendar outra,
 * em laço.
 */
function marcar(){
if(!fetchOriginal)return;
var c=corpo();
if(c===gravado)return;
gravado=c;
fetchOriginal('/cart/update.js',{
method:'POST',
credentials:'same-origin',
headers:{'Content-Type':'application/json','Accept':'application/json'},
body:c
}).catch(function(){if(gravado===c)gravado=null;});
}

function agendar(){
if(corpo()===gravado)return;
setTimeout(marcar,${String(espera)});
}

if(fetchOriginal){
window.fetch=function(entrada,opcoes){
var alvo=typeof entrada==='string'?entrada:(entrada&&entrada.url)||'';
var resposta=fetchOriginal(entrada,opcoes);
try{if(ehMudanca(alvo)){resposta.then(function(){agendar();},function(){});}}catch(e){}
return resposta;
};
}

if(abrirOriginal){
window.XMLHttpRequest.prototype.open=function(metodo,url){
try{if(ehMudanca(url)){this.addEventListener('load',function(){agendar();});}}catch(e){}
return abrirOriginal.apply(this,arguments);
};
}

if(ehPaginaDoCarrinho())marcar();
}catch(e){}
})();true;`;
}

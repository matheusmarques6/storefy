/**
 * Quem é o cliente, dito pela própria página da Shopify (seção 5.6).
 *
 * "Com `OneSignal.login(externalId)`, o `externalId` é o `customerId` quando
 * conhecido." É o que deixa o lojista falar com a PESSOA — o push de "seu
 * pedido saiu" chega no celular de quem comprou, e não num aparelho anônimo.
 *
 * A Shopify já põe o id do cliente logado em toda página da loja, no objeto de
 * análise que ela mesma injeta: `window.__st.cid` e, nos temas mais novos,
 * `ShopifyAnalytics.meta.page.customerId`. O script só lê o que está ali.
 *
 * SÓ O ID, e só quando há um. Página sem cliente logado não manda nada: o
 * checkout novo, por exemplo, não tem esse objeto, e mandar "ninguém" dali
 * desligaria a identificação no meio da compra. Quem desfaz a identificação é
 * a saída explícita da conta, vista pelo endereço (`saiuDaConta`).
 */

/** O script, pronto para entrar no `injectedJavaScript`. */
export function gerarIdentificacaoDoCliente(): string {
  return `(function(){
try{
var id='';
var st=window.__st;
if(st&&typeof st==='object'&&st.cid!=null)id=String(st.cid);
if(!id){
var a=window.ShopifyAnalytics;
var p=a&&a.meta&&a.meta.page;
if(p&&p.customerId!=null)id=String(p.customerId);
}
if(!/^[0-9]{1,20}$/.test(id))return;
if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){
window.ReactNativeWebView.postMessage(JSON.stringify({type:'CUSTOMER_IDENTIFIED',customerId:id}));
}
}catch(e){}
})();`;
}

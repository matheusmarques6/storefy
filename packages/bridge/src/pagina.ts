/**
 * `window.Storefy` — o que o tema do lojista pode chamar (seção 5.5 do plano).
 *
 * Fica neste pacote, e não no app, pela mesma régua do resto daqui: se o tema
 * do lojista encosta, é contrato. O snippet da Theme App Extension vai chamar
 * `window.Storefy.share()` e precisa saber exatamente o que existe e o que
 * cada função devolve.
 *
 * TODA FUNÇÃO DEVOLVE BOOLEANO dizendo se a mensagem chegou ao app. A mesma
 * página abre no navegador do celular, onde `ReactNativeWebView` não existe;
 * sem esse retorno o tema não teria como cair no comportamento web e o botão
 * de compartilhar simplesmente não faria nada.
 */

/** Marca no objeto que impede a segunda injeção de sobrescrever a primeira. */
export const MARCA_DA_API = '__storefy';

/** Estilos aceitos por `Storefy.haptic`, iguais aos do contrato. */
export const ESTILOS_DE_HAPTIC = ['light', 'medium', 'success'] as const;

/** O script que instala `window.Storefy`, pronto para `injectedJavaScript`. */
export function gerarApiDaPagina(): string {
  return `(function(){
try{
if(window.Storefy&&window.Storefy.${MARCA_DA_API})return;

function enviar(carga){
try{
if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){
window.ReactNativeWebView.postMessage(JSON.stringify(carga));
return true;
}
}catch(e){}
return false;
}

function texto(v){return typeof v==='string'?v.trim():'';}

window.Storefy={
${MARCA_DA_API}:true,
share:function(url,titulo){
var carga={type:'SHARE',url:texto(url)||String(location.href)};
var t=texto(titulo);
if(t)carga.title=t;
return enviar(carga);
},
haptic:function(estilo){
var e=texto(estilo);
if(${JSON.stringify(ESTILOS_DE_HAPTIC)}.indexOf(e)<0)e='light';
return enviar({type:'HAPTIC',style:e});
},
openExternal:function(url){
var u=texto(url);
if(!u)return false;
return enviar({type:'OPEN_EXTERNAL',url:u});
},
requestPushPermission:function(){
return enviar({type:'REQUEST_PUSH_PERMISSION'});
}
};
}catch(e){}
})();`;
}

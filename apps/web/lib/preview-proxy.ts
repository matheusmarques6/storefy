/**
 * O que o proxy de prévia pode buscar, e como o HTML volta (seção 4, fase 2).
 *
 * UM PROXY É UM PEDIDO DE SSRF ESPERANDO ACONTECER. Este só existe porque o
 * iframe da prévia precisa de duas coisas que a loja do cliente não dá: origem
 * própria (para o seletor visual poder tocar no documento) e ausência de
 * `X-Frame-Options`, que muitas lojas mandam e que deixaria a prévia em branco
 * sem dizer por quê.
 *
 * Em troca, o alvo é limitado ao que a PRÓPRIA loja registrou, e hospedeiro
 * interno é recusado antes de qualquer requisição sair. As duas regras estão
 * aqui, puras e testadas, porque errar nelas é entregar a rede interna.
 */

export type DestinoDaPrevia = { ok: true; url: string } | { ok: false; motivo: string };

/** Faixas que nunca saem da própria infraestrutura. */
const HOSTS_INTERNOS = new Set(['localhost', 'ip6-localhost', 'ip6-loopback', 'broadcasthost']);
const SUFIXOS_INTERNOS = ['.localhost', '.local', '.internal', '.home.arpa'];

/**
 * O hospedeiro aponta para fora da nossa infraestrutura?
 *
 * `169.254.169.254` é o endereço de metadados da nuvem; alcançá-lo entrega
 * credencial de máquina. As faixas privadas e a de loopback levam ao que roda
 * ao lado do servidor, que é pior ainda.
 */
export function ehHostPublico(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (host === '') return false;
  if (HOSTS_INTERNOS.has(host)) return false;
  if (SUFIXOS_INTERNOS.some((sufixo) => host.endsWith(sufixo))) return false;

  // IPv6 entre colchetes, como a URL entrega.
  const semColchetes = host.replace(/^\[|\]$/g, '');
  if (semColchetes.includes(':')) {
    const baixo = semColchetes;
    if (baixo === '::' || baixo === '::1') return false;
    // fc00::/7 (únicos locais) e fe80::/10 (link-local).
    if (/^f[cd]/.test(baixo) || /^fe[89ab]/.test(baixo)) return false;
    return true;
  }

  const octetos = semColchetes.split('.');
  if (octetos.length === 4 && octetos.every((parte) => /^\d{1,3}$/.test(parte))) {
    const [a = 0, b = 0] = octetos.map((parte) => Number.parseInt(parte, 10));
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
    return true;
  }

  // Nome sem ponto não é domínio público (`intranet`, `db`, nome de container).
  return semColchetes.includes('.');
}

function hostNormalizado(entrada: string): string {
  return entrada
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

/** O alvo pertence a um dos domínios que a loja registrou? */
export function dominioPermitido(hostname: string, dominios: readonly string[]): boolean {
  const alvo = hostNormalizado(hostname);
  if (alvo === '') return false;

  return dominios
    .map((entrada) => {
      const limpa = entrada.trim();
      if (limpa === '') return '';
      try {
        return hostNormalizado(
          new URL(limpa.includes('://') ? limpa : `https://${limpa}`).hostname,
        );
      } catch {
        return '';
      }
    })
    .filter((base) => base !== '')
    .some((base) => alvo === base || alvo.endsWith(`.${base}`));
}

/**
 * Resolve o endereço que a prévia vai buscar.
 *
 * Recebe o caminho pedido pelo editor e a URL da loja vinda do BANCO — nunca
 * uma URL completa do navegador. Assim, o pior que um parâmetro forjado faz é
 * pedir outra página da mesma loja.
 */
export function destinoDaPrevia(
  urlDaLoja: string,
  caminho: string,
  dominios: readonly string[],
): DestinoDaPrevia {
  let base: URL;
  try {
    base = new URL(urlDaLoja);
  } catch {
    return { ok: false, motivo: 'O endereço cadastrado para a loja não é válido.' };
  }

  let alvo: URL;
  try {
    alvo = new URL(caminho === '' ? '/' : caminho, base);
  } catch {
    return { ok: false, motivo: 'Endereço de prévia inválido.' };
  }

  if (alvo.protocol !== 'http:' && alvo.protocol !== 'https:') {
    return { ok: false, motivo: 'Só endereços http e https podem ser visualizados.' };
  }
  if (!ehHostPublico(alvo.hostname)) {
    return { ok: false, motivo: 'Este endereço não pode ser visualizado.' };
  }
  if (!dominioPermitido(alvo.hostname, [base.hostname, ...dominios])) {
    return { ok: false, motivo: 'A prévia só abre endereços da sua própria loja.' };
  }

  return { ok: true, url: alvo.toString() };
}

// ------------------------------------------------------------ reescrita

/** Marca do bloco que injetamos, para o seletor visual saber o que é nosso. */
export const MARCA_DA_PREVIA = 'storefy-previa';

/**
 * Prepara o HTML da loja para ser exibido dentro do iframe da prévia.
 *
 * O `<base>` é o que faz todo o resto funcionar: com ele, imagem, CSS e script
 * relativos continuam saindo DIRETO da loja, e só o documento passa por aqui.
 * Sem o `<base>`, cada `/assets/x.css` viraria uma requisição ao painel.
 *
 * As metatags de CSP e de enquadramento são removidas porque o navegador as
 * aplicaria mesmo vindo de nós, e a prévia ficaria em branco.
 */
export function prepararHtmlDaPrevia(
  html: string,
  opcoes: { base: string; css: string; js?: string },
): string {
  let saida = html;

  // Metatags que bloqueariam o enquadramento ou o nosso estilo.
  saida = saida.replace(
    /<meta[^>]+http-equiv\s*=\s*["']?(content-security-policy|x-frame-options)["']?[^>]*>/gi,
    '',
  );

  // Um `<base>` do próprio tema apontaria para outro lugar.
  saida = saida.replace(/<base\b[^>]*>/gi, '');

  const bloco = [
    `<base href="${escaparAtributo(opcoes.base)}">`,
    `<style id="${MARCA_DA_PREVIA}-estilo">${opcoes.css}</style>`,
    opcoes.js === undefined || opcoes.js === ''
      ? ''
      : `<script id="${MARCA_DA_PREVIA}-script">${opcoes.js}</script>`,
  ].join('');

  if (/<head[^>]*>/i.test(saida)) {
    return saida.replace(
      /<head([^>]*)>/i,
      (_tag, atributos: string) => `<head${atributos}>${bloco}`,
    );
  }
  if (/<html[^>]*>/i.test(saida)) {
    return saida.replace(
      /<html([^>]*)>/i,
      (_tag, atributos: string) => `<html${atributos}><head>${bloco}</head>`,
    );
  }
  // Documento sem `<head>` nem `<html>` acontece com tema quebrado e com
  // resposta de erro do servidor da loja; o bloco na frente ainda funciona.
  return `${bloco}${saida}`;
}

function escaparAtributo(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** O CSS que a prévia injeta: o mesmo `hideSelectors` que o app aplica. */
export function cssDaPrevia(seletores: readonly string[]): string {
  return seletores
    .map((seletor) => seletor.trim())
    .filter((seletor) => seletor !== '' && !seletor.includes('{') && !seletor.includes('}'))
    .map((seletor) => `${seletor}{display:none !important;}`)
    .join('\n');
}

// ------------------------------------------------- script dentro da prévia

/**
 * O script que roda DENTRO do iframe da prévia.
 *
 * Existe porque o iframe é `sandbox` SEM `allow-same-origin`, de propósito: o
 * documento vem da nossa origem, e deixá-lo manter essa origem daria ao tema do
 * lojista — e a todo script de terceiro que ele instalou — acesso aos cookies e
 * ao armazenamento do painel. Numa origem opaca isso não acontece, mas o painel
 * também não alcança o documento; a conversa passa a ser por `postMessage`, e é
 * este script que atende do outro lado.
 *
 * Tudo aqui é defensivo: a página em volta não é nossa, e uma exceção nossa
 * apareceria como erro da loja.
 */
export function gerarScriptDaPrevia(): string {
  return `(function(){
try{
var ID='${MARCA_DA_PREVIA}-ao-vivo';

function estilo(){
var e=document.getElementById(ID);
if(!e){
e=document.createElement('style');
e.id=ID;
(document.head||document.documentElement).appendChild(e);
}
return e;
}

function aplicar(css){
try{estilo().textContent=String(css||'');}catch(err){}
}

window.addEventListener('message',function(evento){
try{
var dados=evento.data;
if(!dados||dados.fonte!=='${MARCA_DA_PREVIA}')return;
if(dados.tipo==='css')aplicar(dados.css);
}catch(err){}
});

function avisarPronto(){
try{
if(window.parent&&window.parent!==window){
window.parent.postMessage({fonte:'${MARCA_DA_PREVIA}',tipo:'pronto'},'*');
}
}catch(err){}
}

if(document.readyState==='loading'){
document.addEventListener('DOMContentLoaded',avisarPronto);
}else{
avisarPronto();
}
}catch(err){}
})();`;
}

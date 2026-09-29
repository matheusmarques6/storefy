/**
 * Os scripts que cada WebView injeta, montados a partir da `AppConfig`.
 *
 * São TRÊS injeções, e a separação não é estética:
 *
 *   1. antes do conteúdo — CSS e `window.__STOREFY__`. Tem que ser cedo, senão
 *      o cabeçalho do tema pisca antes de sumir.
 *   2. depois do DOM — observador de carrinho e `window.Storefy`. Código nosso,
 *      sempre sintaticamente válido.
 *   3. o JavaScript do lojista — injetado SEPARADO, numa chamada só dele.
 *      Um `customJs` com erro de sintaxe derruba o script inteiro em que
 *      estiver, porque o parse acontece antes de qualquer linha rodar. Junto do
 *      nosso, um ponto e vírgula errado no painel apagaria o badge do carrinho
 *      e o compartilhar da loja toda, sem nenhuma pista de por quê.
 */
import { gerarApiDaPagina, gerarInjecao } from '@storefy/bridge';
import type { AppConfig } from '@storefy/config-schema';
import { gerarObservadorDeCarrinho } from './carrinho';
import { gerarAtualizacaoDoPush, gerarMarcaDoApp, type MarcaDoPush } from './atribuicao';
import { gerarIdentificacaoDoCliente } from './cliente';

export interface ContextoDoApp {
  platform: 'ios' | 'android';
  appVersion: string;
  pushEnabled: boolean;
}

/** `injectedJavaScriptBeforeContentLoaded`. */
export function scriptAntesDoConteudo(config: AppConfig, contexto: ContextoDoApp): string {
  return gerarInjecao({
    hideSelectors: config.webview.hideSelectors,
    customCss: config.webview.customCss,
    contexto,
    // O zoom por pinça é o que mais entrega que ali dentro tem um site.
    bloquearZoom: true,
    // O botão "Compartilhar" dos temas da Shopify abre a folha do sistema.
    compartilharNativo: true,
  });
}

/**
 * O carrinho precisa ser observado nesta config?
 *
 * Numa loja Shopify, SEMPRE. O badge é só o efeito visível: o carrinho
 * abandonado nasce dos eventos de carrinho, o token que liga o pedido ao
 * aparelho vem da leitura de `/cart.js`, e nada disso depende de uma aba
 * mostrar a contagem. Condicionar ao badge desligaria em silêncio a automação
 * que o lojista ligou no painel, só porque ele tirou o número da barra.
 *
 * Fora da Shopify, `/cart.js` não existe: só vale observar se alguma aba
 * mostra a contagem, e o tema responder no mesmo formato.
 */
export function observaCarrinho(config: AppConfig): boolean {
  return (
    config.store.platform === 'shopify' || config.tabs.some((aba) => aba.badge === 'cart_count')
  );
}

/**
 * A marca de atribuição entra nesta config?
 *
 * Só em loja Shopify: numa loja `other` os endpoints de carrinho não existem,
 * e insistir seria uma requisição perdida por página na loja do cliente.
 *
 * Diferente do observador de carrinho, NÃO depende de nenhuma aba: a receita
 * do app é medida em toda loja, tenha ela badge de carrinho ou não.
 */
export function marcaOCarrinho(config: AppConfig): boolean {
  return config.store.platform === 'shopify';
}

/**
 * `injectedJavaScript`: só código nosso.
 *
 * `marcaDoPush` é o toque na notificação que ainda responde pela compra, e vai
 * para a página antes da marca, que o lê na hora de gravar o carrinho.
 */
export function scriptDepoisDoConteudo(
  config: AppConfig,
  marcaDoPush: MarcaDoPush | null = null,
): string {
  const partes = [gerarApiDaPagina()];

  /*
   * A marca vem ANTES do observador, e a ordem não é estética: quem injeta
   * depois embrulha o `fetch` de quem veio antes. Nesta ordem, a gravação da
   * marca usa o `fetch` de verdade e o observador não a vê — ao contrário, a
   * marcação dispararia uma leitura de `/cart.js` a mais, toda vez.
   */
  if (marcaOCarrinho(config)) partes.push(gerarAtualizacaoDoPush(marcaDoPush), gerarMarcaDoApp());
  if (observaCarrinho(config)) partes.push(gerarObservadorDeCarrinho());
  // Quem é o cliente: só a Shopify põe o id dele na página.
  if (config.store.platform === 'shopify') partes.push(gerarIdentificacaoDoCliente());
  // Termina em `true;`: no iOS, um retorno não serializável derruba a injeção
  // com um aviso que não aparece em lugar nenhum.
  return `${partes.join('\n')}\ntrue;`;
}

/**
 * O `customJs` do lojista, para uma chamada própria de `injectJavaScript`.
 *
 * Devolve `null` quando não há nada a injetar, para quem chama não gastar uma
 * ida à WebView à toa.
 */
export function scriptDoLojista(config: AppConfig): string | null {
  const custom = config.webview.customJs.trim();
  if (custom === '') return null;
  return `(function(){try{\n${custom}\n}catch(erro){}})();true;`;
}

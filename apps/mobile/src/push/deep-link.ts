/**
 * Para onde o app vai quando o cliente toca numa notificação (seção 5.6).
 *
 * "Clique no push: `data.deep_link` → a aba correta executa NAVIGATE."
 *
 * Isto é decisão pura, separada do SDK, porque é onde mora o erro que custa
 * caro: uma notificação de promoção que abre a home em vez da coleção
 * anunciada desperdiça o único toque que o cliente ia dar. E porque o valor
 * vem do painel, digitado por um lojista — vai chegar com espaço, com URL
 * inteira, com `#` na frente e, um dia, com algo que não devia abrir.
 */

import { mesmoDominio } from '@storefy/bridge';

/** O que a camada nativa faz com o toque. */
export type DestinoDoPush =
  /** Navegar para este caminho dentro da loja, na aba mais adequada. */
  | { destino: 'caminho'; caminho: string }
  /** Sem link: só abrir o app, onde ele estava. */
  | { destino: 'abrir' };

/** O payload que interessa de uma notificação do OneSignal. */
export interface NotificacaoRecebida {
  additionalData?: unknown;
  launchURL?: string;
}

function textoDe(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/**
 * Extrai o link cru da notificação.
 *
 * `deep_link` é o campo que o nosso despachante preenche. `launchURL` é o
 * campo do próprio OneSignal, que um lojista pode ter usado direto no painel
 * deles — aceitar os dois evita a notificação que "não faz nada ao tocar".
 */
export function linkDaNotificacao(notificacao: NotificacaoRecebida): string {
  const dados =
    notificacao.additionalData !== null && typeof notificacao.additionalData === 'object'
      ? (notificacao.additionalData as Record<string, unknown>)
      : {};

  const doNosso = textoDe(dados.deep_link);
  return doNosso === '' ? textoDe(notificacao.launchURL) : doNosso;
}

/**
 * Transforma o link num caminho dentro da loja.
 *
 * SÓ CAMINHO DA PRÓPRIA LOJA. Uma notificação é conteúdo que alguém escreveu
 * num painel, e mandar o app abrir um host qualquer sem barra de endereço é
 * entregar uma tela de phishing perfeita — com o ícone e o nome da loja em
 * volta. Link de outro domínio vira "só abrir o app": o cliente chega na loja,
 * que é o pior caso aceitável.
 *
 * `dominios` são os da config da loja, e `urlDaLoja` é a URL principal.
 */
export function destinoDoPush(
  link: string,
  urlDaLoja: string,
  dominios: readonly string[],
): DestinoDoPush {
  const bruto = link.trim();
  if (bruto === '') return { destino: 'abrir' };

  let alvo: URL;
  try {
    // A base é a URL da loja: assim `/promocoes` e `promocoes` resolvem para o
    // lugar certo, e uma URL inteira ignora a base, como deve.
    alvo = new URL(bruto, urlDaLoja);
  } catch {
    return { destino: 'abrir' };
  }

  if (alvo.protocol !== 'http:' && alvo.protocol !== 'https:') return { destino: 'abrir' };

  /*
   * `mesmoDominio` vem do `@storefy/bridge`, que é onde a mesma pergunta já é
   * feita para os links da WebView. Uma segunda cópia desta comparação aqui
   * seria o pior tipo de duplicação: as duas começam iguais, uma é corrigida,
   * e a outra vira o buraco que ninguém lembra de olhar.
   */
  const permitidos = [urlDaLoja, ...dominios].map(hostDe).filter((host) => host !== '');
  if (!permitidos.some((base) => mesmoDominio(alvo.hostname, base))) {
    return { destino: 'abrir' };
  }

  // Query e fragmento seguem junto: `/search?q=tenis` e `/produto#avaliacoes`
  // são links legítimos, e cortá-los levaria à página errada.
  return { destino: 'caminho', caminho: `${alvo.pathname}${alvo.search}${alvo.hash}` };
}

function hostDe(entrada: string): string {
  const texto = entrada.trim();
  if (texto === '') return '';
  try {
    return new URL(texto.includes('://') ? texto : `https://${texto}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

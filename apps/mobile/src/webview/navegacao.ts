/**
 * Para onde vai cada toque dentro da WebView.
 *
 * A regra em si é do `@storefy/bridge`; o que mora aqui é a CHAMADA, que tem
 * uma armadilha própria. `destinoDoLink` recebe a URL da página em que o
 * cliente está, e usa o host dela como domínio permitido — é o que mantém a
 * navegação dentro de um subdomínio que o lojista esqueceu de listar.
 *
 * Passar a URL ALVO nesse lugar, que é o que a WebView entrega de mão beijada
 * em `onShouldStartLoadWithRequest`, faz todo link virar "mesmo domínio":
 * Instagram, WhatsApp e concorrente abrindo dentro do app, sem barra de
 * endereço e sem jeito de sair. Esta função existe para essa troca ficar
 * impossível de fazer sem querer — e para o teste abaixo dela cobrar isso.
 */
import { destinoDoLink, type DestinoDoLink } from '@storefy/bridge';

export function decidirNavegacao(
  alvo: string,
  /** Onde o cliente está agora, e NÃO para onde ele quer ir. */
  urlAtual: string,
  dominios: readonly string[],
): DestinoDoLink {
  return destinoDoLink(alvo, { urlAtual, dominios });
}

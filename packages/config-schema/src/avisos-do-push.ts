/**
 * O que o pedido de permissão do app (M03) pode prometer ao cliente.
 *
 * A tela prometia sempre "aviso quando o seu pedido sair para entrega" e "o
 * produto de volta ao estoque" — e numa loja com essas automações desligadas
 * o cliente aceitava por uma promessa que não chegava. Agora o app pergunta à
 * Storefy quais avisos a loja manda (`GET /api/public/push-avisos/<app>`) e
 * lista só esses, além das promoções, que toda loja pode mandar.
 *
 * Mora aqui, no contrato painel ⇄ app, para os dois lados falarem dos mesmos
 * avisos com os mesmos nomes.
 */

/** Os avisos que dependem de uma automação ligada. As promoções não dependem. */
export const AVISOS_DO_PUSH = ['carrinho', 'pedido', 'estoque'] as const;
export type AvisoDoPush = (typeof AVISOS_DO_PUSH)[number];

/** A automação (`push_automations.type`) por trás de cada aviso. */
const AUTOMACAO_DO_AVISO: Record<AvisoDoPush, string> = {
  carrinho: 'abandoned_cart',
  pedido: 'order_shipped',
  estoque: 'back_in_stock',
};

/** Os avisos que a loja manda, pelos tipos das automações LIGADAS, na ordem da tela. */
export function avisosDasAutomacoes(tiposLigados: readonly string[]): AvisoDoPush[] {
  return AVISOS_DO_PUSH.filter((aviso) => tiposLigados.includes(AUTOMACAO_DO_AVISO[aviso]));
}

/**
 * A resposta da rota, lida no app: `{ avisos: [...] }`. O que não for aviso
 * conhecido é descartado; uma resposta fora do formato vira `null`, e a tela
 * promete só as promoções.
 */
export function lerAvisosDoPush(dados: unknown): AvisoDoPush[] | null {
  if (dados === null || typeof dados !== 'object') return null;
  const { avisos } = dados as { avisos?: unknown };
  if (!Array.isArray(avisos)) return null;
  return AVISOS_DO_PUSH.filter((aviso) => avisos.includes(aviso));
}

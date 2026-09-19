/**
 * As tags que o app grava no OneSignal (seção 5.6 do plano).
 *
 * Tag é o que o lojista usa para segmentar: "quem tem carrinho acima de R$ 200
 * e não comprou". Sem elas a campanha só consegue falar com todo mundo, que é
 * a forma mais rápida de treinar o cliente a ignorar notificação.
 *
 * Tudo aqui é string porque o OneSignal só guarda string. Os números vão em
 * formato que dá para comparar do lado de lá: valor em CENTAVOS (inteiro, sem
 * vírgula nem símbolo de moeda, que estragariam a comparação) e data em
 * SEGUNDOS desde 1970 (é o formato que os filtros relativos do OneSignal
 * entendem, ao contrário de um texto ISO).
 */

export const TAG_CARRINHO = 'cart_count';
export const TAG_VALOR = 'cart_value';
export const TAG_ULTIMO_CARRINHO = 'last_cart_at';
export const TAG_COMPROU = 'has_purchased';
export const TAG_VERSAO = 'app_version';

export interface CarrinhoParaTag {
  count: number;
  /** Em centavos, quando a página informou. */
  totalCents?: number;
  quandoMs: number;
}

/**
 * Tags do carrinho.
 *
 * Carrinho vazio zera o valor junto com a contagem: deixar `cart_value` em
 * R$ 300 depois de o cliente esvaziar o carrinho faria a campanha de
 * "carrinho alto" falar com quem não tem carrinho nenhum.
 *
 * `last_cart_at` NÃO é atualizado quando o carrinho esvazia: ele marca a
 * última vez que houve carrinho, e é isso que a segmentação de recuperação
 * pergunta.
 */
export function tagsDoCarrinho(carrinho: CarrinhoParaTag): Record<string, string> {
  const vazio = carrinho.count <= 0;

  const tags: Record<string, string> = {
    [TAG_CARRINHO]: String(Math.max(0, Math.trunc(carrinho.count))),
    [TAG_VALOR]: vazio ? '0' : String(Math.max(0, Math.trunc(carrinho.totalCents ?? 0))),
  };

  if (!vazio) {
    tags[TAG_ULTIMO_CARRINHO] = String(Math.floor(carrinho.quandoMs / 1000));
  }

  return tags;
}

/**
 * Tags de quem acabou de comprar.
 *
 * O carrinho zera junto: depois do checkout ele está vazio de fato, e sem isso
 * o cliente entraria na campanha de carrinho abandonado logo após comprar.
 */
export function tagsDaCompra(): Record<string, string> {
  return { [TAG_COMPROU]: 'true', [TAG_CARRINHO]: '0', [TAG_VALOR]: '0' };
}

/**
 * Tags de contexto do app.
 *
 * `app_version` serve para não mandar push de um recurso que a versão
 * instalada não tem — a notificação levaria a uma tela que não existe.
 */
export function tagsDoApp(appVersion: string): Record<string, string> {
  return { [TAG_VERSAO]: appVersion };
}

/**
 * Qual notificação trouxe o cliente — o elo que liga a receita ao push
 * (C07, C09 e C10).
 *
 * A corrente é a mesma da marca `_storefy` (ver `ATRIBUTO_DO_CARRINHO`), com
 * um elo a mais: o despachante põe o id da campanha (ou da automação) nos
 * dados da notificação; o app, quando o cliente toca, guarda essa origem e a
 * hora do toque; ao mexer no carrinho, grava o atributo `_storefy_push` junto
 * com a marca; a Shopify carrega o atributo até o pedido; e o webhook
 * `orders/create` o lê.
 *
 * É ATRIBUIÇÃO PELO DADO DA PRÓPRIA SHOPIFY, e com prazo: um toque responde
 * pela compra por três dias. O prazo é conferido dos DOIS lados. O app só
 * grava o atributo enquanto o toque vale; e o webhook confere a hora do toque,
 * que viaja no próprio atributo, contra a hora do pedido — porque um carrinho
 * parado guarda o atributo, e a compra feita nele um mês depois não é mérito
 * da notificação de hoje.
 *
 * Mora aqui, no contrato painel ⇄ app, pela mesma razão da marca: uma cópia
 * de cada lado se desencontraria no dia em que alguém renomeasse uma, e a
 * receita do push sumiria sem erro em lugar nenhum.
 */

/** O atributo de carrinho. O `_` na frente a Shopify esconde do cliente final. */
export const ATRIBUTO_DO_PUSH = '_storefy_push';

/** Por quanto tempo um toque na notificação responde pela compra. */
export const JANELA_DO_PUSH_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * A folga para o relógio do celular.
 *
 * A hora do toque vem do aparelho; a do pedido, da Shopify. Um celular cinco
 * minutos adiantado faria o pedido feito logo depois do toque parecer
 * ANTERIOR a ele, e a campanha perderia a venda que trouxe. Uma hora cobre o
 * relógio desacertado de verdade sem abrir a janela de três dias.
 */
export const FOLGA_DO_RELOGIO_MS = 60 * 60 * 1000;

/** De que envio veio o toque: uma campanha (C08) ou uma automação (C09). */
export interface OrigemDoPush {
  tipo: 'campanha' | 'automacao';
  id: string;
}

/** Um toque na notificação: de onde ela veio e quando o cliente tocou. */
export interface ToqueNoPush {
  origem: OrigemDoPush;
  tocadaEmMs: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uuid(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim().toLowerCase();
  return UUID.test(limpo) ? limpo : null;
}

/** Os campos que o despachante acrescenta aos dados da notificação. */
export function dadosDaOrigem(origem: OrigemDoPush): Record<string, string> {
  return origem.tipo === 'campanha' ? { campanha: origem.id } : { automacao: origem.id };
}

/** A origem nos dados de uma notificação tocada — ou `null`, se não veio de nós. */
export function origemDaNotificacao(dados: unknown): OrigemDoPush | null {
  if (dados === null || typeof dados !== 'object') return null;
  const { campanha, automacao } = dados as { campanha?: unknown; automacao?: unknown };
  const idDaCampanha = uuid(campanha);
  if (idDaCampanha !== null) return { tipo: 'campanha', id: idDaCampanha };
  const idDaAutomacao = uuid(automacao);
  if (idDaAutomacao !== null) return { tipo: 'automacao', id: idDaAutomacao };
  return null;
}

/**
 * O valor do atributo de carrinho: `c:<uuid>:<segundos>` (campanha) ou
 * `a:<uuid>:<segundos>` (automação), com a hora do toque em segundos.
 *
 * É também o formato em que o app guarda o toque no aparelho: um formato só,
 * lido pela mesma função dos dois lados.
 */
export function valorDoAtributoDoPush(toque: ToqueNoPush): string {
  const segundos = Math.floor(toque.tocadaEmMs / 1000);
  return `${toque.origem.tipo === 'campanha' ? 'c' : 'a'}:${toque.origem.id}:${String(segundos)}`;
}

/** O atributo lido de volta. Qualquer outra coisa é "não veio de push". */
export function lerAtributoDoPush(valor: unknown): ToqueNoPush | null {
  if (typeof valor !== 'string') return null;
  const achado = /^([ca]):([0-9a-f-]{36}):(\d{1,12})$/.exec(valor.trim().toLowerCase());
  if (achado === null) return null;
  const id = uuid(achado[2]);
  const segundos = Number(achado[3]);
  if (id === null || !Number.isSafeInteger(segundos) || segundos === 0) return null;
  return {
    origem: { tipo: achado[1] === 'c' ? 'campanha' : 'automacao', id },
    tocadaEmMs: segundos * 1000,
  };
}

/**
 * O toque ainda responde por uma compra feita em `momentoMs`?
 *
 * Com a folga do relógio nas duas pontas: um pedido não acontece antes do
 * toque que o gravou no carrinho, então "antes" só pode ser relógio
 * desacertado — e passado da folga, é atributo que não se explica, e não leva
 * o crédito.
 */
export function toqueAindaVale(tocadaEmMs: number, momentoMs: number): boolean {
  if (!Number.isFinite(tocadaEmMs) || !Number.isFinite(momentoMs)) return false;
  const passou = momentoMs - tocadaEmMs;
  return passou >= -FOLGA_DO_RELOGIO_MS && passou <= JANELA_DO_PUSH_MS + FOLGA_DO_RELOGIO_MS;
}

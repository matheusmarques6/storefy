/**
 * Como a tela fala do que as notificações venderam (C07, C09 e C10).
 *
 * O número vem da atribuição pelo toque (`@storefy/config-schema`,
 * `atribuicao-do-push`): um pedido conta para a notificação que o cliente
 * tocou até três dias antes de comprar. Aqui mora só a apresentação — quando a
 * tela pode afirmar um valor, e como montar o funil sem inventar etapa.
 */
import { comoReais } from '@/lib/analytics';
import type { MetricasDaCampanha, StatusDaCampanha } from '@/lib/campanha';

/** A janela do resultado das automações e do total do topo, em dias. */
export const JANELA_DAS_VENDAS_EM_DIAS = 30;

/** Pedidos e receita que vieram de um toque. */
export interface Vendas {
  pedidos: number;
  receitaCents: number;
}

/**
 * A tela pode afirmar quanto as notificações venderam?
 *
 * Só com a Shopify conectada. Os pedidos chegam pelo webhook dela, e sem ele
 * a receita seria sempre zero — um zero que diria ao lojista que as
 * notificações não vendem nada, quando a verdade é que a Storefy não está
 * vendo os pedidos (regra 1 do CLAUDE.md).
 */
export function vendasVisiveis(loja: {
  platform: string;
  shopify_scopes: readonly string[] | null;
}): boolean {
  return loja.platform === 'shopify' && loja.shopify_scopes !== null;
}

/** Por que a receita aparece como traço. */
export const MOTIVO_SEM_VENDAS = 'Conecte a Shopify para ver quanto cada notificação vendeu.';

/**
 * A receita de uma campanha, como a lista e o detalhe mostram.
 *
 * Traço antes do envio — não existe venda de campanha que não saiu — e sem a
 * Shopify conectada. Depois do envio, zero é resposta: a campanha saiu, a
 * Storefy vê os pedidos, e nenhum veio dela.
 */
export function receitaDaCampanha(
  status: StatusDaCampanha,
  vendas: Vendas | undefined,
  visiveis: boolean,
): string {
  if (!visiveis || status !== 'sent' || vendas === undefined) return '—';
  return comoReais(vendas.receitaCents);
}

/** "3 pedidos", "1 pedido", "nenhum pedido". */
export function textoDosPedidos(pedidos: number): string {
  if (pedidos === 0) return 'nenhum pedido';
  return `${pedidos.toLocaleString('pt-BR')} ${pedidos === 1 ? 'pedido' : 'pedidos'}`;
}

/** A legenda do total do topo, na janela de 30 dias. */
export function dicaDasVendas(vendas: Vendas): string {
  const janela = `nos últimos ${String(JANELA_DAS_VENDAS_EM_DIAS)} dias`;
  if (vendas.pedidos === 0) return `Nenhum pedido ${janela} veio de uma notificação.`;
  return `${textoDosPedidos(vendas.pedidos)} ${janela}, de quem tocou numa notificação.`;
}

/** Receita sobre pedidos. `null` sem pedido — ticket médio de zero pedidos não existe. */
export function ticketMedio(vendas: Vendas): number | null {
  return vendas.pedidos > 0 ? Math.round(vendas.receitaCents / vendas.pedidos) : null;
}

export interface EtapaDoFunil {
  chave: 'enviados' | 'entregues' | 'aberturas' | 'pedidos';
  rotulo: string;
  /** `null` quando o número ainda não existe (ou a Shopify não está conectada). */
  valor: number | null;
  /**
   * Quanto da etapa anterior chegou a esta, de 0 a 1. `null` sem as duas, ou
   * quando a conta passa de 100% — pedidos que chegam depois da última
   * leitura das aberturas, por exemplo. Uma taxa de 140% não explica nada ao
   * lojista, só o faz desconfiar do resto da tela.
   */
  taxa: number | null;
  /** A largura da barra: a fração do topo do funil, de 0 a 1. */
  largura: number | null;
  explicacao: string;
}

/**
 * O funil de uma campanha: enviados → entregues → aberturas → pedidos.
 *
 * O topo é o primeiro número que existe, e cada barra é a fração dele. Etapa
 * sem número fica sem barra, com traço — o funil nunca desenha um zero que
 * não aconteceu.
 */
export function funilDaCampanha(
  metricas: MetricasDaCampanha,
  vendas: Vendas | undefined,
  visiveis: boolean,
): EtapaDoFunil[] {
  const valores: Pick<EtapaDoFunil, 'chave' | 'rotulo' | 'valor' | 'explicacao'>[] = [
    {
      chave: 'enviados',
      rotulo: 'Enviados',
      valor: metricas.enviados,
      explicacao: 'Aparelhos para os quais a notificação saiu.',
    },
    {
      chave: 'entregues',
      rotulo: 'Entregues',
      valor: metricas.entregues,
      explicacao: 'Chegaram ao celular. Quem desinstalou o app fica de fora.',
    },
    {
      chave: 'aberturas',
      rotulo: 'Aberturas',
      valor: metricas.abertos,
      explicacao: 'Tocaram na notificação e abriram o app.',
    },
    {
      chave: 'pedidos',
      rotulo: 'Pedidos',
      valor: visiveis && vendas !== undefined ? vendas.pedidos : null,
      explicacao: visiveis
        ? 'Compraram até 3 dias depois de tocar na notificação.'
        : MOTIVO_SEM_VENDAS,
    },
  ];

  const topo = valores.find((etapa) => etapa.valor !== null)?.valor ?? null;

  return valores.map((etapa, indice) => {
    const anterior = indice === 0 ? null : (valores[indice - 1]?.valor ?? null);
    const taxa =
      etapa.valor !== null && anterior !== null && anterior > 0 && etapa.valor <= anterior
        ? etapa.valor / anterior
        : null;
    const largura =
      etapa.valor !== null && topo !== null && topo > 0 ? Math.min(etapa.valor / topo, 1) : null;
    return { ...etapa, taxa, largura };
  });
}

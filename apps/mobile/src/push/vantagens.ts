/**
 * O que o pedido de permissão (M03) lista, a partir dos avisos que a loja
 * manda de verdade (`avisosParaPrometer`).
 *
 * As promoções vêm sempre: toda loja pode mandar uma campanha. O resto só com
 * a automação ligada — a lista fixa prometia "pedido saiu para entrega" numa
 * loja que nunca mandaria esse aviso.
 */
import type { AvisoDoPush } from '@storefy/config-schema';

/** Os nomes de ícone que a tela usa (Ionicons). */
export type IconeDaVantagem =
  'pricetag-outline' | 'cart-outline' | 'cube-outline' | 'refresh-outline';

export interface Vantagem {
  icone: IconeDaVantagem;
  texto: string;
}

const PROMOCOES: Vantagem = {
  icone: 'pricetag-outline',
  texto: 'Promoções e cupons antes de acabarem',
};

const DO_AVISO: Record<AvisoDoPush, Vantagem> = {
  carrinho: { icone: 'cart-outline', texto: 'Um lembrete do que ficou no carrinho' },
  pedido: { icone: 'cube-outline', texto: 'Aviso quando o seu pedido sair para entrega' },
  estoque: { icone: 'refresh-outline', texto: 'O produto que você queria de volta ao estoque' },
};

/** As linhas da tela, na ordem: promoções primeiro, depois cada aviso ligado, sem repetir. */
export function vantagensDoPrePrompt(avisos: readonly AvisoDoPush[]): Vantagem[] {
  return [PROMOCOES, ...[...new Set(avisos)].map((aviso) => DO_AVISO[aviso])];
}

/**
 * Os nomes de ícone que uma aba pode usar.
 *
 * É contrato, e por isso mora aqui: o painel desenha com lucide e o app com
 * Ionicons — bibliotecas diferentes, com nomes diferentes para o mesmo
 * desenho. O que atravessa a config é ESTE nome, e cada lado tem a sua tabela
 * de tradução, com teste cobrando que nenhum da lista fique sem desenho.
 *
 * Sem essa lista no meio, o lojista escolheria no painel um ícone que o app não
 * conhece e veria três pontinhos no celular, sem entender o que houve.
 *
 * Os nomes seguem o lucide, que é o que aparece no editor.
 */
export const NOMES_DE_ICONE = [
  'house',
  'search',
  'shopping-bag',
  'shopping-cart',
  'user',
  'bell',
  'heart',
  'grid',
  'layers',
  'tag',
  'percent',
  'star',
  'menu',
  'package',
  'message-circle',
  'map-pin',
  'flame',
  'sparkles',
  'gift',
  'compass',
] as const;

export type NomeDeIcone = (typeof NOMES_DE_ICONE)[number];

/** O nome está na lista? Usado pelo editor e pelas duas tabelas de tradução. */
export function ehNomeDeIcone(nome: string): nome is NomeDeIcone {
  return (NOMES_DE_ICONE as readonly string[]).includes(nome.trim().toLowerCase());
}

/** Rótulo em português para o seletor de ícone do editor. */
export const ROTULO_DO_ICONE: Record<NomeDeIcone, string> = {
  house: 'Casa',
  search: 'Lupa',
  'shopping-bag': 'Sacola',
  'shopping-cart': 'Carrinho',
  user: 'Pessoa',
  bell: 'Sino',
  heart: 'Coração',
  grid: 'Grade',
  layers: 'Camadas',
  tag: 'Etiqueta',
  percent: 'Porcentagem',
  star: 'Estrela',
  menu: 'Menu',
  package: 'Caixa',
  'message-circle': 'Balão de conversa',
  'map-pin': 'Localização',
  flame: 'Chama',
  sparkles: 'Brilhos',
  gift: 'Presente',
  compass: 'Bússola',
};

/**
 * Nome do ícone da config → glifo do Ionicons (seção 5.3 do plano).
 *
 * O painel grava o ícone como texto livre (`icon: z.string()`), então este
 * arquivo é o único lugar que sabe traduzir. Um nome que não existe no Ionicons
 * vira um quadrado em branco na barra de abas, sem erro e sem aviso: por isso o
 * teste confere cada glifo contra o mapa real da fonte, e por isso existe um
 * padrão para o que não estiver na lista.
 *
 * Os nomes de entrada seguem o lucide-react, que é o que o painel usa — assim o
 * lojista escolhe "shopping-bag" no editor e vê a mesma coisa no app.
 *
 * Aqui não se importa `@expo/vector-icons`: é só tradução de texto, e sem o
 * import dá para testar sem aparelho.
 */

/** Par de glifos: contorno para aba inativa, cheio para a ativa. */
export interface ParDeIcones {
  vazio: string;
  cheio: string;
}

function par(base: string): ParDeIcones {
  return { vazio: `${base}-outline`, cheio: base };
}

/** Tradução dos nomes do painel para os glifos do Ionicons. */
export const ICONES: Readonly<Record<string, ParDeIcones>> = {
  house: par('home'),
  home: par('home'),
  search: par('search'),
  'shopping-bag': par('bag-handle'),
  bag: par('bag-handle'),
  'shopping-cart': par('cart'),
  cart: par('cart'),
  user: par('person'),
  account: par('person'),
  bell: par('notifications'),
  notifications: par('notifications'),
  heart: par('heart'),
  grid: par('grid'),
  layers: par('albums'),
  tag: par('pricetag'),
  percent: par('pricetags'),
  star: par('star'),
  menu: par('menu'),
  package: par('cube'),
  'message-circle': par('chatbubble'),
  'map-pin': par('location'),
  flame: par('flame'),
  sparkles: par('sparkles'),
  gift: par('gift'),
  compass: par('compass'),
};

/**
 * Glifo para um ícone desconhecido.
 *
 * Três pontinhos, e não um ícone com significado: a aba continua tocável e
 * legível pelo rótulo, e o lojista percebe que aquele ícone não pegou.
 */
export const ICONE_PADRAO: ParDeIcones = par('ellipsis-horizontal');

/** O glifo do Ionicons para uma aba. */
export function iconeDaAba(nome: string, ativa: boolean): string {
  const limpo = nome.trim().toLowerCase();
  const encontrado = Object.hasOwn(ICONES, limpo) ? ICONES[limpo] : undefined;
  const escolhido = encontrado ?? ICONE_PADRAO;
  return ativa ? escolhido.cheio : escolhido.vazio;
}

/**
 * Nome do ícone na config → componente do lucide.
 *
 * O app desenha com Ionicons e o painel com lucide: bibliotecas diferentes,
 * nomes diferentes para o mesmo desenho. O que atravessa a config é o nome de
 * `NOMES_DE_ICONE`, e cada lado tem a sua tabela. O teste ao lado cobra que
 * nenhum nome do contrato fique sem desenho aqui — o que o lojista não
 * consegue ver, ele não escolhe.
 *
 * Fica em `.ts` e não junto do componente de propósito: é dado, e dado se testa
 * sem precisar montar React.
 */
import {
  Bell,
  Compass,
  Flame,
  Gift,
  Grid3x3,
  Heart,
  House,
  Layers,
  MapPin,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Package,
  Percent,
  Search,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Tag,
  User,
  type LucideIcon,
} from 'lucide-react';

export const ICONES_DO_PAINEL: Record<string, LucideIcon> = {
  house: House,
  home: House,
  search: Search,
  'shopping-bag': ShoppingBag,
  bag: ShoppingBag,
  'shopping-cart': ShoppingCart,
  cart: ShoppingCart,
  user: User,
  account: User,
  bell: Bell,
  notifications: Bell,
  heart: Heart,
  grid: Grid3x3,
  layers: Layers,
  tag: Tag,
  percent: Percent,
  star: Star,
  menu: Menu,
  package: Package,
  'message-circle': MessageCircle,
  'map-pin': MapPin,
  flame: Flame,
  sparkles: Sparkles,
  gift: Gift,
  compass: Compass,
};

/** O mesmo três-pontinhos que o app usa quando não conhece o nome. */
export const ICONE_PADRAO_DO_PAINEL = MoreHorizontal;

/** O componente de um nome, sempre com um desenho de volta. */
export function iconeDoPainel(nome: string): LucideIcon {
  const limpo = nome.trim().toLowerCase();
  if (!Object.hasOwn(ICONES_DO_PAINEL, limpo)) return ICONE_PADRAO_DO_PAINEL;
  return ICONES_DO_PAINEL[limpo] ?? ICONE_PADRAO_DO_PAINEL;
}

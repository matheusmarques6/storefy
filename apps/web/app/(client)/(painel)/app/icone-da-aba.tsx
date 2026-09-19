'use client';

/** O ícone de uma aba, pelo nome que está na config. */
import { createElement, type CSSProperties } from 'react';
import { iconeDoPainel } from '@/lib/icones-do-painel';

export function IconeDaAba({
  nome,
  className,
  style,
}: {
  nome: string;
  className?: string;
  style?: CSSProperties;
}) {
  /*
   * `createElement` e não `<Icone />`: o componente vem de uma tabela, e uma
   * variável em maiúscula no meio do render faz o compilador do React achar que
   * um componente está sendo CRIADO ali — o que remontaria a árvore a cada
   * desenho.
   */
  return createElement(iconeDoPainel(nome), { 'aria-hidden': true, className, style });
}

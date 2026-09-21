/**
 * As capturas de tela que cada loja de aplicativos exige (seção 7 do plano).
 *
 * É o último item que trava a publicação, e o mais fácil de errar: a App Store
 * recusa por tamanho de imagem, e a recusa chega dias depois sem dizer qual
 * captura estava errada.
 *
 * A STOREFY NÃO GERA ESTAS IMAGENS, e este arquivo existe para dizer isso com
 * todas as letras. Uma captura feita de um navegador com a largura de um
 * celular não é o app: falta a barra de status do aparelho, a tab bar nativa e
 * o recorte da tela, e a Apple recusa screenshot que é claramente montagem.
 * A única fonte fiel é o app rodando num aparelho — o Storefy Preview antes de
 * publicar, ou o app da loja depois.
 */

export interface Captura {
  loja: 'App Store' | 'Play Store';
  /** Como a loja de aplicativos chama este tamanho. */
  nome: string;
  /** Quantas a loja exige, no mínimo. */
  minimo: number;
  /** Medida exata, quando a loja exige uma. */
  medida: string;
  comoTirar: string;
}

/**
 * O que é preciso entregar.
 *
 * A Apple pede a maior tela de iPhone e reaproveita a imagem para os tamanhos
 * menores; o Google aceita qualquer proporção de celular, desde que o lado
 * menor passe de 320 px.
 */
export const CAPTURAS: readonly Captura[] = [
  {
    loja: 'App Store',
    nome: 'iPhone 6.9"',
    minimo: 1,
    medida: '1290 × 2796 px',
    comoTirar:
      'Abra o app num iPhone 15 Pro Max, 16 Pro Max ou mais novo e aperte o botão lateral com o de aumentar volume.',
  },
  {
    loja: 'Play Store',
    nome: 'Celular',
    minimo: 2,
    medida: 'no mínimo 320 px no lado menor',
    comoTirar:
      'Abra o app num Android e aperte o botão de ligar com o de abaixar volume. Qualquer celular serve.',
  },
];

/**
 * A instrução de onde tirar as capturas, conforme o app já existe ou não.
 *
 * Antes de publicar não há app na loja para abrir: o jeito é o Storefy
 * Preview, que mostra o rascunho no aparelho de verdade. Depois de publicado,
 * o próprio app da loja é a fonte certa.
 */
export function ondeTirar(jaPublicado: boolean): string {
  return jaPublicado
    ? 'Use o app da sua loja, já instalado no celular.'
    : 'Use o app Storefy Preview com o código da prévia: ele mostra o seu app no celular de verdade, do jeito que ele vai ficar.';
}

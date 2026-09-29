/**
 * A conta do arrastar e soltar das abas (C06b). A tela mede, estas funções
 * decidem — assim o gesto se testa sem navegador.
 */

/**
 * Para onde vai a aba arrastada: o destino que `moverAba` recebe.
 *
 * `centros` são os centros verticais das abas na tela, na ordem atual — a
 * arrastada inclusive, no lugar de onde saiu — e `y`, o centro da arrastada
 * agora. O destino é quantas OUTRAS abas têm o centro acima dela: a posição
 * que ela passa a ocupar depois de sair da origem. Passar do centro de uma
 * vizinha é o que troca as duas.
 */
export function destinoDoArraste(centros: readonly number[], y: number, origem: number): number {
  let destino = 0;
  centros.forEach((centro, indice) => {
    if (indice !== origem && centro < y) destino += 1;
  });
  return destino;
}

/**
 * Quanto uma vizinha anda para abrir espaço para a arrastada: as que ficam
 * entre a origem e o destino andam um `passo` (a altura da arrastada mais o
 * espaço entre as abas) no sentido contrário ao do arraste.
 */
export function deslocamentoDaVizinha(
  indice: number,
  origem: number,
  destino: number,
  passo: number,
): number {
  if (origem < destino && indice > origem && indice <= destino) return -passo;
  if (destino < origem && indice >= destino && indice < origem) return passo;
  return 0;
}

/** Faixa do alto da janela que rola a página; o cabeçalho fixo do painel ocupa o começo dela. */
const ZONA_DE_CIMA = 96;
/** Faixa do pé da janela que rola a página. */
const ZONA_DE_BAIXO = 64;
/** Pixels por quadro, no máximo: a página rola mais rápido quanto mais perto da borda. */
const VELOCIDADE_MAXIMA = 16;

/**
 * Com a aba arrastada perto da borda da janela, a página rola sozinha para
 * levar a aba aonde não se via. Negativo sobe, positivo desce, zero fica.
 */
export function velocidadeDaRolagem(y: number, alturaDaJanela: number): number {
  if (y < ZONA_DE_CIMA) {
    const dentro = ZONA_DE_CIMA - Math.max(y, 0);
    return -Math.ceil((VELOCIDADE_MAXIMA * dentro) / ZONA_DE_CIMA);
  }
  const pe = alturaDaJanela - ZONA_DE_BAIXO;
  if (y > pe) {
    const dentro = Math.min(y, alturaDaJanela) - pe;
    return Math.ceil((VELOCIDADE_MAXIMA * dentro) / ZONA_DE_BAIXO);
  }
  return 0;
}

/** O que o leitor de tela diz depois que uma aba muda de lugar. */
export function anuncioDaOrdem(rotulo: string, indice: number, total: number): string {
  const nome = rotulo.trim() === '' ? 'A aba sem nome' : `“${rotulo.trim()}”`;
  return `${nome} agora é a ${String(indice + 1)}ª de ${String(total)} abas.`;
}

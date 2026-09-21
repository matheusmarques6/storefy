/**
 * A correção OTA para todas as lojas (seção 7 do plano).
 *
 * Um bug no JavaScript do app não precisa de build novo nem de revisão da
 * Apple: o `expo-updates` baixa o pacote corrigido na próxima abertura. É a
 * diferença entre consertar em minutos e consertar em três dias.
 *
 * UMA PUBLICAÇÃO POR LOJA, e isso não é zelo excessivo: o pacote JavaScript
 * carrega as variáveis daquela loja — o id do app dela, o segredo com que o
 * app assina o que manda —, e publicar um pacote só para todos os canais
 * entregaria o segredo de uma loja ao app de outra.
 *
 * ESTE ARQUIVO É PURO, sem `server-only`, porque o formulário do admin precisa
 * do limite da mensagem e da validação para dizer "faltam 3 caracteres" sem
 * ida ao servidor. Quem fala com o GitHub é `lib/disparo-da-ota.ts`, que lê
 * variável de ambiente e por isso não pode ser importado pelo navegador.
 */

/**
 * A mensagem que acompanha a correção.
 *
 * Ela aparece no painel do Expo ao lado da atualização, e é o que alguém vai
 * ler daqui a seis meses tentando entender o que foi publicado. Vazia não
 * serve; gigante também não, porque o Expo corta.
 */
export const MAXIMO_DA_MENSAGEM = 120;

export function mensagemValida(texto: string): boolean {
  const limpo = texto.trim();
  return limpo.length >= 5 && limpo.length <= MAXIMO_DA_MENSAGEM;
}

/** O canal de EAS Update de uma loja. Um por loja, sempre. */
export function canalDaOta(storeId: string): string {
  return `production-${storeId}`;
}

export interface ProgressoDaOta {
  total: number | null;
  concluidas: number;
  falhas: number;
}

/**
 * A rodada terminou?
 *
 * Só quando o workflow contou o total E todas as lojas responderam. Enquanto o
 * total for nulo, a matriz nem foi montada — dar por encerrada ali mostraria
 * "concluída, 0 de 0" no admin.
 */
export function terminou(progresso: ProgressoDaOta): boolean {
  if (progresso.total === null) return false;
  return progresso.concluidas + progresso.falhas >= progresso.total;
}

/** O texto de andamento, em português, para a tela do admin. */
export function resumoDaOta(status: string, progresso: ProgressoDaOta): string {
  if (status === 'queued') return 'Na fila. O GitHub vai começar em instantes.';
  if (status === 'errored' && progresso.total === null) {
    return 'A rodada não chegou a começar.';
  }

  const total = progresso.total;
  if (total === null) return 'Preparando a lista de lojas.';

  const feitas = progresso.concluidas + progresso.falhas;
  const parte = `${String(feitas)} de ${String(total)} ${total === 1 ? 'loja' : 'lojas'}`;

  if (status === 'running') return `Publicando: ${parte}.`;
  if (progresso.falhas === 0) return `Publicada em ${parte}.`;
  return `${parte}, com ${String(progresso.falhas)} ${
    progresso.falhas === 1 ? 'falha' : 'falhas'
  }.`;
}

/**
 * O aviso no topo do app (C06e › aviso no topo; desenhado na casca, M04).
 *
 * Uma faixa curta em cima da loja — "Frete grátis acima de R$ 199" — que o
 * lojista liga no painel, sem build. O toque leva a um endereço DA LOJA, pela
 * mesma regra do toque numa notificação (`destinoDoPush`): o texto foi
 * escrito num painel, e abrir um host qualquer sem barra de endereço, com o
 * nome da loja em volta, seria uma tela de phishing perfeita. Link de fora
 * vira aviso só de texto.
 *
 * O cliente pode fechar. Fechado, o aviso só volta quando o TEXTO muda: ver o
 * mesmo aviso a cada abertura ensina a ignorá-lo, e um aviso novo merece ser
 * visto.
 */
import type { AppConfig } from '@storefy/config-schema';
import { destinoDoPush } from '../push/deep-link';

export interface AvisoDoTopo {
  texto: string;
  /** O caminho da loja que o toque abre; `null` quando o aviso é só texto. */
  caminho: string | null;
}

/** O aviso a mostrar, ou `null` quando está desligado ou sem texto. */
export function avisoDoTopo(config: AppConfig): AvisoDoTopo | null {
  const aviso = config.announcement;
  if (!aviso?.enabled) return null;
  const texto = aviso.text.trim();
  if (texto === '') return null;

  const destino = destinoDoPush(aviso.url ?? '', config.store.url, config.store.domains);
  return { texto, caminho: destino.destino === 'caminho' ? destino.caminho : null };
}

/** Se o cliente já fechou ESTE aviso. Outro texto é outro aviso. */
export function avisoFoiFechado(aviso: AvisoDoTopo, textoFechado: string | null): boolean {
  return textoFechado === aviso.texto;
}

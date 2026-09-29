/**
 * Escapa texto que entra no HTML do e-mail.
 *
 * O nome da loja vem do lojista. Sem escapar, um nome com `<` quebraria o
 * layout do e-mail de todo mundo daquela organização — e cliente de e-mail não
 * é navegador, mas continua interpretando marcação.
 */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

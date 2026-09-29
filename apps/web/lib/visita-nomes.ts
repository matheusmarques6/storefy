/**
 * Os nomes dos cookies da visita ao painel do cliente ("Ver como cliente").
 *
 * Moram num arquivo à parte, sem `server-only`, porque o proxy precisa deles
 * e não pode importar o resto de `lib/visita.ts` (que usa a chave do
 * servidor). O proxy não confere assinatura nenhuma: para BLOQUEAR escrita,
 * basta o cookie existir — um cookie forjado só consegue travar quem o forjou.
 */

/** A visita em si: organização, quem visita e até quando. Assinado. */
export const COOKIE_VISITA = 'storefy_visita';

/**
 * A loja aberta durante a visita. Separado do `storefy_loja` de propósito: a
 * pessoa da equipe também é cliente, e visitar alguém não pode trocar a loja
 * que ELA deixou selecionada no próprio painel.
 */
export const COOKIE_LOJA_DA_VISITA = 'storefy_visita_loja';

/** Os caminhos que aceitam escrita durante a visita: sair dela e trocar de loja. */
export const PREFIXO_DAS_ROTAS_DA_VISITA = '/visita/';

/** Tamanho do motivo da visita, que vai para a auditoria. Ver `conferirMotivo`. */
export const MOTIVO_MINIMO_DA_VISITA = 10;
export const MOTIVO_MAXIMO_DA_VISITA = 300;

/**
 * De quem é o token da visita, lido SEM conferir a assinatura.
 *
 * Serve a um propósito só: o proxy saber se o cookie é da pessoa que está
 * usando o navegador. Uma visita que ficou para trás — o admin saiu da conta
 * sem encerrar, e outra pessoa entrou no mesmo computador — não pode travar a
 * escrita de quem não tem nada com ela. Para LIBERAR o acesso aos dados de um
 * cliente, a assinatura é conferida por inteiro em `lib/visita.ts`.
 */
export function donoDoToken(token: string | undefined): string | null {
  const carga = token?.split('.')[1];
  if (carga == null || carga === '') return null;
  try {
    const json = atob(carga.replace(/-/g, '+').replace(/_/g, '/'));
    const { admin } = JSON.parse(json) as { admin?: unknown };
    return typeof admin === 'string' ? admin : null;
  } catch {
    return null;
  }
}

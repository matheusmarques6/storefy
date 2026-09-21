import 'server-only';

/**
 * As duas assinaturas da Shopify.
 *
 * DUAS, DIFERENTES, e confundi-las é o erro clássico:
 *
 *   o RETORNO DO OAUTH assina a query string, ordenada, sem o próprio `hmac`,
 *   com `&` e `=` como separadores, e o resultado é HEX;
 *   o WEBHOOK assina o CORPO CRU e o resultado é BASE64, no cabeçalho
 *   `x-shopify-hmac-sha256`.
 *
 * As duas usam o mesmo segredo do app e o mesmo SHA-256, e é só isso que elas
 * têm em comum.
 *
 * Fica separado de `lib/shopify.ts` por causa do `node:crypto`: a tela de
 * integrações é um componente de cliente e importa dali o crivo de domínio.
 * Um módulo só arrastaria `node:crypto` para o navegador e quebraria o build.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A query do retorno do OAuth veio mesmo da Shopify?
 *
 * A mensagem assinada é a query INTEIRA, ordenada por chave, sem o próprio
 * `hmac`, com `&` entre os pares. Reconstruir na ordem errada — ou esquecer um
 * parâmetro que a Shopify acrescentou depois — faz a conferência falhar sempre,
 * e o sintoma é "a conexão com a Shopify parou de funcionar".
 */
export function conferirHmacDaQuery(parametros: URLSearchParams, segredo: string): boolean {
  const recebido = parametros.get('hmac');
  if (recebido === null || recebido === '') return false;
  if (segredo === '') return false;

  const pares: string[] = [];
  for (const [chave, valor] of parametros.entries()) {
    if (chave === 'hmac' || chave === 'signature') continue;
    pares.push(`${chave}=${valor}`);
  }
  pares.sort();

  const esperado = createHmac('sha256', segredo).update(pares.join('&')).digest('hex');
  return iguais(recebido, esperado);
}

/**
 * O webhook veio mesmo da Shopify?
 *
 * Aqui a mensagem é o CORPO CRU, e a assinatura é base64 — não hex. Reserializar
 * o JSON antes de conferir muda um espaço e a assinatura deixa de bater.
 */
export function conferirHmacDoWebhook(
  cabecalho: string | null,
  segredo: string,
  corpo: string,
): boolean {
  if (cabecalho === null || cabecalho.trim() === '' || segredo === '') return false;

  const esperado = createHmac('sha256', segredo).update(corpo, 'utf8').digest('base64');
  return iguais(cabecalho.trim(), esperado);
}

/** Comparação que não entrega a assinatura pelo tempo de resposta. */
function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

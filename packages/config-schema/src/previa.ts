/**
 * O código de prévia: contrato entre o painel, a API e o app Storefy Preview.
 *
 * Mora aqui porque as três pontas precisam concordar sobre o formato. Com uma
 * expressão regular em cada lado, basta uma delas mudar para o app recusar um
 * código que o painel acabou de gerar — e o lojista não teria como saber de
 * qual dos dois é a culpa.
 */

/** Esquema do deep link do app de prévia. */
export const ESQUEMA_DA_PREVIA = 'storefy-preview';

/** 16 bytes em hexadecimal, como `abrir_previa` gera. */
const TOKEN = /^[0-9a-f]{32}$/;

export function ehTokenDePrevia(valor: string): boolean {
  return TOKEN.test(valor.trim().toLowerCase());
}

/** O código em minúsculas e sem espaço, pronto para comparar ou enviar. */
export function normalizarTokenDePrevia(valor: string): string {
  return valor.trim().toLowerCase();
}

/**
 * Extrai o código de um deep link, de uma URL ou do que o lojista digitou.
 *
 * Aceita as três formas porque as três acontecem: a câmera nativa entrega o
 * deep link inteiro, o leitor do app entrega o texto do QR, e quem tem câmera
 * ruim digita os 32 caracteres à mão.
 */
export function lerTokenDePrevia(entrada: string): string | null {
  const bruta = entrada.trim();
  if (bruta === '') return null;

  const direto = normalizarTokenDePrevia(bruta);
  if (ehTokenDePrevia(direto)) return direto;

  // `storefy-preview://p/<token>` e qualquer URL que termine no código.
  const doCaminho = /([0-9a-fA-F]{32})\s*$/.exec(bruta.replace(/[?#].*$/, ''))?.[1];
  if (doCaminho !== undefined && ehTokenDePrevia(doCaminho)) {
    return normalizarTokenDePrevia(doCaminho);
  }

  return null;
}

/** O endereço que devolve o rascunho daquele código. */
export function urlDaPrevia(apiBase: string, token: string): string | null {
  const base = apiBase.trim().replace(/\/+$/, '');
  if (base === '' || !ehTokenDePrevia(token)) return null;

  let raiz: URL;
  try {
    raiz = new URL(base);
  } catch {
    return null;
  }
  if (raiz.protocol !== 'http:' && raiz.protocol !== 'https:') return null;

  return `${base}/api/public/preview-config/${normalizarTokenDePrevia(token)}`;
}

/**
 * O identificador do app nas lojas de aplicativos (C12): `br.com.sualoja.app`.
 *
 * É o nome técnico do app na Apple (bundle ID) e no Google (package name). A
 * seção 10 do plano manda não falar em "bundle ID" com o lojista e preencher
 * por ele: a sugestão sai do domínio da loja, ao contrário, como manda a
 * convenção das duas lojas — `oakvintage.com.br` vira `br.com.oakvintage.app`.
 *
 * O formato é o que a Apple E o Google aceitam ao mesmo tempo: minúsculas e
 * números, cada parte começando por letra. A Apple aceita hífen e o Google
 * aceita sublinhado, mas cada um recusa o do outro. O banco confere o mesmo
 * formato (migration 51); aqui ele é conferido antes, para a mensagem sair em
 * português e no campo certo.
 */

export const FORMATO_DO_IDENTIFICADOR = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
export const MAXIMO_DO_IDENTIFICADOR = 150;

/**
 * As palavras do Java, que o Android recusa como parte do identificador — uma
 * loja em `new.com.br` geraria `br.com.new.app`, e o build morreria no fim.
 */
const RESERVADAS_NO_ANDROID = new Set([
  'abstract',
  'assert',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extends',
  'false',
  'final',
  'finally',
  'float',
  'for',
  'goto',
  'if',
  'implements',
  'import',
  'instanceof',
  'int',
  'interface',
  'long',
  'native',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'short',
  'static',
  'strictfp',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'true',
  'try',
  'void',
  'volatile',
  'while',
]);

/** O que o lojista digitou, do jeito que vai ser gravado. */
export function normalizarIdentificador(bruto: string): string {
  return bruto.trim().toLowerCase();
}

/** O problema do identificador, em português, ou `null` quando serve. */
export function problemaDoIdentificador(bruto: string): string | null {
  const texto = normalizarIdentificador(bruto);
  if (texto === '') return 'Informe o identificador do app.';
  if (texto.length > MAXIMO_DO_IDENTIFICADOR) {
    return `O identificador passa de ${String(MAXIMO_DO_IDENTIFICADOR)} caracteres.`;
  }
  if (!FORMATO_DO_IDENTIFICADOR.test(texto)) {
    return 'Use só letras minúsculas e números, em partes separadas por ponto, como br.com.sualoja.app.';
  }
  // A Apple reserva o próprio prefixo; o app seria recusado no primeiro envio.
  if (texto.startsWith('com.apple.'))
    return 'Identificadores começando por com.apple são da Apple.';
  const reservada = texto.split('.').find((parte) => RESERVADAS_NO_ANDROID.has(parte));
  if (reservada !== undefined) {
    return `"${reservada}" é uma palavra reservada no Android e não pode ser parte do identificador.`;
  }
  return null;
}

/** Uma parte do identificador: sem acento, sem símbolo, começando por letra. */
function limparParte(parte: string): string {
  let limpa = parte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (limpa === '') return '';
  if (/^[0-9]/.test(limpa)) limpa = `n${limpa}`;
  if (RESERVADAS_NO_ANDROID.has(limpa)) limpa = `${limpa}app`;
  return limpa;
}

/**
 * A sugestão para uma loja: o domínio ao contrário, mais `.app`.
 *
 * Loja só com o endereço `*.myshopify.com` não tem domínio próprio, e o
 * identificador não deve carregar o nome da Shopify: sai do nome da loja.
 */
export function identificadorSugerido(urlDaLoja: string, nomeDaLoja: string): string {
  let host = '';
  try {
    host = new URL(urlDaLoja).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    host = '';
  }

  const doDominio =
    host === '' || host.endsWith('.myshopify.com') || !host.includes('.')
      ? []
      : host.split('.').reverse().map(limparParte);
  const partes = doDominio.filter((parte) => parte !== '');
  const doNome = limparParte(nomeDaLoja);

  const candidato =
    partes.length >= 2
      ? [...partes, 'app'].join('.')
      : ['com', doNome === '' ? 'minhaloja' : doNome, 'app'].join('.');

  const cortado = candidato.slice(0, MAXIMO_DO_IDENTIFICADOR).replace(/\.+$/, '');
  return problemaDoIdentificador(cortado) === null ? cortado : 'com.minhaloja.app';
}

/**
 * As alternativas, na ordem, para quando a sugestão já é de outro app da
 * Storefy: `…app`, `…app2`, `…app3`. A tela oferece a primeira livre.
 */
export function alternativasDoIdentificador(base: string, quantas = 9): string[] {
  const lista = [base];
  for (let numero = 2; numero <= quantas; numero += 1) lista.push(`${base}${String(numero)}`);
  return lista.filter((item) => item.length <= MAXIMO_DO_IDENTIFICADOR);
}

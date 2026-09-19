/**
 * A config que viaja dentro do binário (seção 5.3 do plano).
 *
 * POR QUE UM REGISTRO, e não um caminho montado com o `storeId`: o Metro
 * resolve `import` em tempo de build e não entende caminho dinâmico. Um
 * `require('../../brands/' + storeId + '/config.json')` compila e falha no
 * aparelho, que é o pior lugar para descobrir.
 *
 * Cada loja nova entra com uma linha aqui e uma pasta em `brands/`. O teste
 * deste arquivo percorre `brands/` e cobra as duas coisas, então esquecer a
 * linha quebra no CI e não na mão do cliente. No build por loja (seção 7) o
 * workflow gera este registro com a marca única daquele app.
 */
import oakvintage from '../../brands/oakvintage/config.json';

/** Toda config embutida, por `storeId`. */
export const CONFIGS_EMBUTIDAS: Readonly<Record<string, unknown>> = {
  oakvintage,
};

/**
 * A config embutida desta loja, ou `null` quando o build não trouxe nenhuma.
 *
 * Devolve `unknown` de propósito: quem chama passa por `decidirConfig`, que
 * valida. Um atalho tipado aqui esconderia um JSON desatualizado no build.
 */
export function configEmbutida(storeId: string): unknown {
  // `Object.hasOwn` e não acesso direto: `CONFIGS_EMBUTIDAS['constructor']`
  // devolveria uma função do protótipo, e o app tentaria abrir com ela.
  if (!Object.hasOwn(CONFIGS_EMBUTIDAS, storeId)) return null;
  return CONFIGS_EMBUTIDAS[storeId] ?? null;
}

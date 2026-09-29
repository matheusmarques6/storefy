/**
 * Registra a config de uma loja em `embutida.ts`, no build por loja.
 *
 * O Metro só empacota o JSON que um `import` estático alcança. O workflow
 * grava a config da loja em `brands/<loja>/config.json`, e esta função escreve
 * a linha que a torna alcançável — entre os marcadores do arquivo, que é o
 * único trecho que ela toca.
 *
 * Função pura, sobre o TEXTO do arquivo: é o que deixa testar sem mexer no
 * disco, e o script do workflow só lê, chama e grava.
 */

const IMPORTS = { inicio: '// registro:imports:inicio', fim: '// registro:imports:fim' };
const MAPA = { inicio: '// registro:mapa:inicio', fim: '// registro:mapa:fim' };

/** O id vira pasta e identificador: só o que é seguro nos dois. */
const ID_SEGURO = /^[a-z0-9][a-z0-9-]*$/i;

function trecho(fonte: string, marcas: { inicio: string; fim: string }): [number, number] {
  const inicio = fonte.indexOf(marcas.inicio);
  const fim = fonte.indexOf(marcas.fim);
  if (inicio === -1 || fim === -1 || fim < inicio) {
    throw new Error(`embutida.ts sem os marcadores ${marcas.inicio} / ${marcas.fim}.`);
  }
  return [inicio + marcas.inicio.length, fim];
}

function inserir(fonte: string, marcas: { inicio: string; fim: string }, linha: string): string {
  const [depoisDoInicio, antesDoFim] = trecho(fonte, marcas);
  const miolo = fonte.slice(depoisDoInicio, antesDoFim);
  if (miolo.includes(linha)) return fonte;

  // Mantém a indentação do marcador de fim para a linha nova.
  const recuo = /[ \t]*$/.exec(fonte.slice(0, antesDoFim))?.[0] ?? '';
  return `${fonte.slice(0, antesDoFim)}${linha}\n${recuo}${fonte.slice(antesDoFim)}`;
}

export function registrarConfigEmbutida(fonte: string, storeId: string): string {
  if (!ID_SEGURO.test(storeId)) {
    throw new Error(`Id de loja inválido para o registro: ${JSON.stringify(storeId)}`);
  }

  const identificador = `loja_${storeId.replace(/-/g, '_')}`;
  const comImport = inserir(
    fonte,
    IMPORTS,
    `import ${identificador} from '../../brands/${storeId}/config.json';`,
  );
  return inserir(comImport, MAPA, `'${storeId}': ${identificador},`);
}

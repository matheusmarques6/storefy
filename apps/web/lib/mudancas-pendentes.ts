/**
 * Quantas mudanças o rascunho tem em relação à versão no ar (C06).
 *
 * É o contador do botão "Publicar alterações" (seção 10 do plano). A conta é
 * por AJUSTE, e não por campo do JSON: trocar duas abas de lugar é uma
 * mudança para quem editou, e não as dez propriedades que andaram. Por isso:
 *
 *   - cada cor, cada opção de uma seção, conta uma;
 *   - nas abas, cada aba nova, removida ou alterada conta uma, e mudar a
 *     ordem conta uma a mais;
 *   - `version` não conta — ela muda a cada publicação por definição.
 *
 * As comparações ignoram a ORDEM das chaves: a versão no ar volta do banco
 * (jsonb, que não guarda a ordem), e uma aba criada no editor tem as chaves
 * na ordem em que o código as escreveu. Comparar o texto cru contaria como
 * mudança uma aba idêntica.
 */
import type { AppConfig } from '@storefy/config-schema';

type Valor = unknown;

function ehObjeto(valor: Valor): valor is Record<string, Valor> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function ordenado(valor: Valor): Valor {
  if (Array.isArray(valor)) return valor.map(ordenado);
  if (!ehObjeto(valor)) return valor;
  return Object.fromEntries(
    Object.keys(valor)
      .sort()
      .map((chave) => [chave, ordenado(valor[chave])]),
  );
}

/** JSON com as chaves em ordem alfabética, em todos os níveis. */
function jsonCanonico(valor: Valor): string {
  return JSON.stringify(ordenado(valor));
}

function iguais(a: Valor, b: Valor): boolean {
  return jsonCanonico(a) === jsonCanonico(b);
}

/**
 * O que o lojista edita numa config, num texto comparável. Sem `version` e
 * `store`, que o servidor reescreve a cada gravação: é o que diz se a config
 * que voltou do servidor é a mesma que o editor mandou.
 */
export function conteudoDaConfig(config: AppConfig): string {
  return jsonCanonico({ ...config, version: null, store: null });
}

/** Uma seção: cada chave de primeiro nível que mudou conta uma. */
function mudancasNaSecao(rascunho: Valor, publicada: Valor): number {
  if (!ehObjeto(rascunho) || !ehObjeto(publicada)) return iguais(rascunho, publicada) ? 0 : 1;
  const chaves = new Set([...Object.keys(rascunho), ...Object.keys(publicada)]);
  let total = 0;
  for (const chave of chaves) {
    if (!iguais(rascunho[chave], publicada[chave])) total += 1;
  }
  return total;
}

/** As abas: pelo `id`, que é o que sobrevive a renomear e a reordenar. */
function mudancasNasAbas(rascunho: AppConfig['tabs'], publicada: AppConfig['tabs']): number {
  const daPublicada = new Map(publicada.map((aba) => [aba.id, aba]));
  const doRascunho = new Map(rascunho.map((aba) => [aba.id, aba]));

  let total = 0;
  for (const aba of rascunho) {
    const antes = daPublicada.get(aba.id);
    if (antes === undefined || !iguais(aba, antes)) total += 1;
  }
  for (const aba of publicada) {
    if (!doRascunho.has(aba.id)) total += 1;
  }

  const ordemDoRascunho = rascunho.map((aba) => aba.id).filter((id) => daPublicada.has(id));
  const ordemDaPublicada = publicada.map((aba) => aba.id).filter((id) => doRascunho.has(id));
  if (!iguais(ordemDoRascunho, ordemDaPublicada)) total += 1;

  return total;
}

export function mudancasPendentes(rascunho: AppConfig, publicada: AppConfig): number {
  const chaves = new Set([...Object.keys(rascunho), ...Object.keys(publicada)]);
  chaves.delete('version');

  let total = 0;
  for (const chave of chaves) {
    const deRascunho = (rascunho as unknown as Record<string, Valor>)[chave];
    const daPublicada = (publicada as unknown as Record<string, Valor>)[chave];
    total +=
      chave === 'tabs'
        ? mudancasNasAbas(rascunho.tabs, publicada.tabs)
        : mudancasNaSecao(deRascunho, daPublicada);
  }
  return total;
}

/** "1 mudança", "3 mudanças" — e nada quando não há. */
export function descricaoDasMudancas(total: number): string {
  if (total <= 0) return 'Igual à versão no ar';
  return total === 1
    ? '1 mudança desde a versão no ar'
    : `${String(total)} mudanças desde a versão no ar`;
}

/**
 * Quantas mudanças o rascunho tem em relação à versão no ar (C06).
 *
 * É o contador do botão "Publicar alterações" (seção 10 do plano) — e é o
 * tamanho da lista que o diálogo de publicar mostra (`diferencasDaConfig`).
 * Uma fonte só: o número no botão nunca discorda da lista que o lojista lê.
 */
import { safeParseAppConfig, type AppConfig } from '@storefy/config-schema';
import { diferencasDaConfig, jsonCanonico } from '@/lib/diferencas-da-config';

/**
 * O que o lojista edita numa config, num texto comparável. Sem `version` e
 * `store`, que o servidor reescreve a cada gravação: é o que diz se a config
 * que voltou do servidor é a mesma que o editor mandou.
 */
export function conteudoDaConfig(config: AppConfig): string {
  return jsonCanonico({ ...config, version: null, store: null });
}

/**
 * A impressão digital do conteúdo de uma config: curta, e igual para duas
 * configs de mesmo conteúdo — em qualquer ordem de chaves, com `version` e
 * `store` diferentes (publicar cria a próxima versão; mudar o nome da loja
 * reescreve o bloco dela), e com ou sem os valores padrão preenchidos.
 *
 * É como o editor diz ao servidor em cima de QUE rascunho fez a mudança: se o
 * do banco não tem mais esse conteúdo, outra aba (ou outra pessoa da equipe)
 * gravou no meio, e a gravação para em vez de apagar o que a outra fez.
 */
export function impressaoDaConfig(config: AppConfig): string {
  const lida = safeParseAppConfig(config);
  const texto = conteudoDaConfig(lida.success ? lida.data : config);
  return `${embaralhar(texto, 1).toString(16).padStart(14, '0')}${embaralhar(texto, 2).toString(16).padStart(14, '0')}`;
}

/**
 * cyrb53 (de bryc, domínio público): 53 bits bem espalhados, rápido e igual no
 * navegador e no servidor. Duas sementes dão 106 bits — sem chance prática de
 * duas configs diferentes terem a mesma impressão. Não é segredo nem
 * assinatura: só compara conteúdo.
 */
function embaralhar(texto: string, semente: number): number {
  let h1 = 0xdeadbeef ^ semente;
  let h2 = 0x41c6ce57 ^ semente;
  for (let indice = 0; indice < texto.length; indice += 1) {
    const codigo = texto.charCodeAt(indice);
    h1 = Math.imul(h1 ^ codigo, 2654435761);
    h2 = Math.imul(h2 ^ codigo, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function mudancasPendentes(rascunho: AppConfig, publicada: AppConfig): number {
  return diferencasDaConfig(publicada, rascunho).length;
}

/** "1 mudança", "3 mudanças" — e nada quando não há. */
export function descricaoDasMudancas(total: number): string {
  if (total <= 0) return 'Igual à versão no ar';
  return total === 1
    ? '1 mudança desde a versão no ar'
    : `${String(total)} mudanças desde a versão no ar`;
}

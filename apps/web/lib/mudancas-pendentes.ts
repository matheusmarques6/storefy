/**
 * Quantas mudanças o rascunho tem em relação à versão no ar (C06).
 *
 * É o contador do botão "Publicar alterações" (seção 10 do plano) — e é o
 * tamanho da lista que o diálogo de publicar mostra (`diferencasDaConfig`).
 * Uma fonte só: o número no botão nunca discorda da lista que o lojista lê.
 */
import type { AppConfig } from '@storefy/config-schema';
import { diferencasDaConfig, jsonCanonico } from '@/lib/diferencas-da-config';

/**
 * O que o lojista edita numa config, num texto comparável. Sem `version` e
 * `store`, que o servidor reescreve a cada gravação: é o que diz se a config
 * que voltou do servidor é a mesma que o editor mandou.
 */
export function conteudoDaConfig(config: AppConfig): string {
  return jsonCanonico({ ...config, version: null, store: null });
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

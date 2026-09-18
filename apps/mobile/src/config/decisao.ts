/**
 * Qual `AppConfig` o app usa ao abrir (seção 5.3 do plano).
 *
 * Fica separado da parte que faz IO porque é aqui que estão as decisões que
 * podem dar errado de um jeito caro — abrir o app com config velha, ou pior,
 * travar numa tela de atualização obrigatória por engano.
 *
 * Ordem de preferência: rede > cache > embutida no build.
 *
 * POR QUE A EMBUTIDA EXISTE: na primeira abertura não há cache, e a rede pode
 * estar fora. Sem um terceiro nível, o app estrearia numa tela de erro — a
 * pior primeira impressão possível para quem acabou de instalar.
 */
import { safeParseAppConfig, type AppConfig } from '@storefy/config-schema';

export type OrigemDaConfig = 'rede' | 'cache' | 'embutida';

export type DecisaoDaConfig =
  | { estado: 'pronta'; config: AppConfig; origem: OrigemDaConfig }
  /** `minSupportedBuild` da config é maior que o build instalado. */
  | { estado: 'precisa-atualizar'; minimo: number; atual: number }
  /** Nenhuma fonte deu uma config válida. */
  | { estado: 'sem-config'; motivo: string };

export interface FontesDaConfig {
  /** Resposta da API, quando houve. */
  rede?: unknown;
  /** O que estava guardado no dispositivo. */
  cache?: unknown;
  /** A config que veio dentro do binário, gerada no build da loja. */
  embutida: unknown;
  /** Número do build instalado, para comparar com `minSupportedBuild`. */
  buildAtual: number;
}

/** Tenta validar uma fonte; devolve null quando ela não serve. */
function validar(fonte: unknown): AppConfig | null {
  if (fonte == null) return null;
  const analise = safeParseAppConfig(fonte);
  return analise.success ? analise.data : null;
}

/**
 * Escolhe a config e decide se o app pode abrir.
 *
 * Uma config inválida é DESCARTADA, não corrige. Cache corrompido ou resposta
 * truncada da API são casos reais, e usar meia config produziria uma tela
 * quebrada em vez de um fallback limpo.
 */
export function decidirConfig(fontes: FontesDaConfig): DecisaoDaConfig {
  const candidatas: { config: AppConfig; origem: OrigemDaConfig }[] = [];

  const daRede = validar(fontes.rede);
  if (daRede != null) candidatas.push({ config: daRede, origem: 'rede' });

  const doCache = validar(fontes.cache);
  if (doCache != null) candidatas.push({ config: doCache, origem: 'cache' });

  const embutida = validar(fontes.embutida);
  if (embutida != null) candidatas.push({ config: embutida, origem: 'embutida' });

  const escolhida = candidatas[0];
  if (escolhida == null) {
    return {
      estado: 'sem-config',
      motivo: 'Nenhuma configuração válida disponível (rede, cache e embutida falharam).',
    };
  }

  /*
   * A atualização obrigatória é decidida pela config ESCOLHIDA, e não pela
   * mais recente que apareceu. Se a rede veio inválida e caímos para o cache,
   * mandar atualizar por um número que não conseguimos ler seria prender o
   * usuário fora do app por causa de uma falha nossa.
   */
  if (escolhida.config.minSupportedBuild > fontes.buildAtual) {
    return {
      estado: 'precisa-atualizar',
      minimo: escolhida.config.minSupportedBuild,
      atual: fontes.buildAtual,
    };
  }

  return { estado: 'pronta', config: escolhida.config, origem: escolhida.origem };
}

/**
 * A config da rede merece substituir a do cache?
 *
 * Só quando é válida E não é mais antiga. Uma resposta de CDN desatualizada
 * não deve rebaixar a config que o app já tem.
 */
export function deveGravarNoCache(daRede: unknown, doCache: unknown): boolean {
  const nova = validar(daRede);
  if (nova == null) return false;

  const atual = validar(doCache);
  if (atual == null) return true;

  return nova.version >= atual.version;
}

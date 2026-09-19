/**
 * Qual rascunho de `AppConfig` o editor abre (seção 4 do plano, fase 2).
 *
 * A decisão está separada do banco porque tem três caminhos e um deles é o que
 * salva o dia: um rascunho que não passa mais no schema. Isso acontece de
 * verdade — gravação interrompida, JSON truncado, um campo que mudou de tipo
 * sem respeitar a regra de compatibilidade. Abrir o editor em cima de config
 * quebrada dá tela de formulário sem valores e um "publicar" que grava lixo no
 * app do cliente.
 */
import { configInicial, safeParseAppConfig, type AppConfig } from '@storefy/config-schema';

export interface DadosDaLojaNoBanco {
  name: string;
  primary_url: string;
  shop_domain: string | null;
}

export interface LinhaDeRascunho {
  version: number;
  config: unknown;
}

export type DecisaoDoRascunho =
  /** O rascunho está bom; o editor abre nele. */
  | { acao: 'usar'; version: number; config: AppConfig }
  /** Havia rascunho, mas ilegível. Vai ser reescrito na mesma versão. */
  | { acao: 'consertar'; version: number; config: AppConfig }
  /** Não havia rascunho nenhum. Nasce um. */
  | { acao: 'criar'; version: number; config: AppConfig };

export function decidirRascunho(
  loja: DadosDaLojaNoBanco,
  rascunho: LinhaDeRascunho | null,
  /** Maior `version` já usada neste app, em qualquer status. */
  maiorVersao: number,
): DecisaoDoRascunho {
  const dados = {
    name: loja.name,
    url: loja.primary_url,
    shopDomain: loja.shop_domain,
  };

  if (rascunho === null) {
    /*
     * A próxima versão nunca reaproveita um número já usado, mesmo que a linha
     * tenha sido apagada: `app_configs` tem unique (app_id, version), e o
     * histórico ficaria com dois registros disputando o mesmo número.
     */
    const version = Math.max(maiorVersao, 0) + 1;
    return { acao: 'criar', version, config: configInicial(dados, version) };
  }

  const analise = safeParseAppConfig(rascunho.config);
  if (analise.success) {
    return { acao: 'usar', version: rascunho.version, config: analise.data };
  }

  /*
   * Reconstrói a partir do cadastro da loja, que é a única fonte confiável
   * sobrando. O lojista perde as personalizações daquele rascunho — mas elas já
   * estavam ilegíveis — e ganha de volta um editor que funciona. O que está
   * publicado não é tocado.
   */
  return {
    acao: 'consertar',
    version: rascunho.version,
    config: configInicial(dados, rascunho.version),
  };
}

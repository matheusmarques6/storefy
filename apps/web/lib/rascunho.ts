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
import {
  blocoDaLoja,
  configInicial,
  safeParseAppConfig,
  type AppConfig,
} from '@storefy/config-schema';

export interface DadosDaLojaNoBanco {
  name: string;
  primary_url: string;
  shop_domain: string | null;
  /** `stores.platform`. Decide se o app marca o carrinho para a atribuição. */
  platform: 'shopify' | 'other';
}

export interface LinhaDeRascunho {
  version: number;
  config: unknown;
}

export type DecisaoDoRascunho =
  /** O rascunho está bom; o editor abre nele. */
  | { acao: 'usar'; version: number; config: AppConfig }
  /**
   * O rascunho está bom, mas a loja mudou depois dele (nome, endereço ou
   * plataforma, na tela da loja). O bloco `store` é regravado com o cadastro,
   * e o resto do que o lojista montou fica como está.
   */
  | { acao: 'atualizar'; version: number; config: AppConfig }
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
    platform: loja.platform,
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
    /*
     * O `store` do rascunho segue o cadastro, sempre. Sem isto, trocar o
     * endereço ou a plataforma na tela da loja só chegaria ao app quando o
     * lojista mexesse de novo no editor — e "Publicar" sem mexer em nada
     * poria no ar o endereço antigo, ou a marcação de carrinho da plataforma
     * errada.
     */
    const store = blocoDaLoja(dados);
    if (!mesmaLoja(analise.data.store, store)) {
      return { acao: 'atualizar', version: rascunho.version, config: { ...analise.data, store } };
    }
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

/** Campo a campo, e não por `JSON.stringify`: a ordem das chaves não é dado. */
function mesmaLoja(a: AppConfig['store'], b: AppConfig['store']): boolean {
  return (
    a.name === b.name &&
    a.url === b.url &&
    a.platform === b.platform &&
    a.domains.length === b.domains.length &&
    a.domains.every((dominio, indice) => dominio === b.domains[indice])
  );
}

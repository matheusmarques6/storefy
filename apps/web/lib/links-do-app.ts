/**
 * Links da loja abrindo no app: Universal Links no iPhone e App Links no
 * Android (checklist 5.7 do plano).
 *
 * O app já diz de que domínio é — `associatedDomains` e `intentFilters` no
 * `app.config.ts`, a partir de `STORE_DOMAIN`. Falta a outra ponta: o domínio
 * precisa publicar em `/.well-known/` dois arquivos dizendo "este app pode
 * abrir meus links", o `apple-app-site-association` e o `assetlinks.json`.
 * Sem eles, o sistema ignora a declaração do app, e o link do e-mail, do
 * WhatsApp ou do anúncio abre no navegador.
 *
 * NUMA LOJA SHOPIFY, quem publica os arquivos é a própria Shopify, a partir do
 * que o app cadastra pela API de "Mobile Platform Applications". A permissão
 * dessa API é liberada pela Shopify sob pedido — até lá, a tela diz isso, e o
 * resto do app funciona normalmente.
 *
 * FORA DA SHOPIFY, o lojista publica os arquivos no próprio site, e a tela
 * entrega o conteúdo pronto.
 */

/** A permissão da Shopify que deixa cadastrar o app no domínio da loja. */
export const ESCOPO_DOS_LINKS = 'write_mobile_platform_applications';

/**
 * A impressão digital SHA-256 do certificado que assina o app no Android, no
 * formato que o Play Console mostra e que a Shopify espera (`AA:BB:…`).
 *
 * Aceita com ou sem os dois-pontos, e com espaços — é o que sai de um copiar e
 * colar. Qualquer outra coisa é recusada, e não "consertada": uma impressão
 * errada publicada no domínio faz o Android recusar os links em silêncio.
 */
export function lerImpressaoDigital(texto: string): string | null {
  const limpo = texto.replace(/\s+/g, '').toUpperCase();
  const comPontos = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(limpo);
  const semPontos = /^[0-9A-F]{64}$/.test(limpo);
  if (!comPontos && !semPontos) return null;
  const hex = limpo.replace(/:/g, '');
  return (hex.match(/.{2}/g) ?? []).join(':');
}

/**
 * O App ID que a Apple usa nos Universal Links: `<Team ID>.<bundle>`.
 *
 * O Team ID tem 10 letras e números; sem ele, ou sem o bundle, não há o que
 * publicar.
 */
export function appIdDaApple(teamId: string | null, bundleId: string | null): string | null {
  const time = (teamId ?? '').trim().toUpperCase();
  const pacote = (bundleId ?? '').trim();
  if (!/^[A-Z0-9]{10}$/.test(time)) return null;
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(pacote)) return null;
  return `${time}.${pacote}`;
}

export interface DadosDosLinks {
  plataformaDaLoja: 'shopify' | 'other';
  /** A loja tem o token da Shopify guardado. */
  shopifyConectada: boolean;
  /** Permissões que a loja concedeu (`stores.shopify_scopes`). */
  escoposDaLoja: readonly string[];
  /** A Storefy pede a permissão dos links ao conectar (`SHOPIFY_SCOPES`)? */
  storefyPedeOEscopo: boolean;
  /**
   * Por onde a loja conectou. No app que o próprio lojista criou na Shopify,
   * quem escolhe as permissões é ele — e a mensagem precisa dizer isso.
   */
  conexao: 'oauth' | 'manual' | null;
  bundleIdIos: string | null;
  appleTeamId: string | null;
  packageAndroid: string | null;
  impressoesAndroid: readonly string[];
  iosVinculadoEm: string | null;
  androidVinculadoEm: string | null;
}

export type SituacaoDoLink =
  { estado: 'vinculado'; em: string } | { estado: 'pronto' } | { estado: 'falta'; motivo: string };

export type BloqueioDosLinks =
  | { tipo: 'conectar'; motivo: string }
  | { tipo: 'reconectar'; motivo: string }
  | { tipo: 'aguardando-shopify'; motivo: string };

export interface SituacaoDosLinks {
  /** O que impede as duas plataformas de uma vez. */
  bloqueio: BloqueioDosLinks | null;
  ios: SituacaoDoLink;
  android: SituacaoDoLink;
  /** Há o que mandar a Shopify publicar agora? */
  podeVincular: boolean;
}

function situacaoDoIos(dados: DadosDosLinks): SituacaoDoLink {
  if (dados.bundleIdIos === null || dados.bundleIdIos.trim() === '') {
    return {
      estado: 'falta',
      motivo: 'O identificador do app no iPhone é definido ao criar o registro do app na Apple.',
    };
  }
  if (appIdDaApple(dados.appleTeamId, dados.bundleIdIos) === null) {
    return { estado: 'falta', motivo: 'Conecte a conta Apple da sua empresa.' };
  }
  return dados.iosVinculadoEm === null
    ? { estado: 'pronto' }
    : { estado: 'vinculado', em: dados.iosVinculadoEm };
}

function situacaoDoAndroid(dados: DadosDosLinks): SituacaoDoLink {
  if (dados.packageAndroid === null || dados.packageAndroid.trim() === '') {
    return {
      estado: 'falta',
      motivo: 'O identificador do app no Android é definido ao preparar o primeiro build.',
    };
  }
  if (dados.impressoesAndroid.length === 0) {
    return {
      estado: 'falta',
      motivo:
        'Cole a impressão digital do certificado de assinatura, que fica no Play Console, em Integridade do app.',
    };
  }
  return dados.androidVinculadoEm === null
    ? { estado: 'pronto' }
    : { estado: 'vinculado', em: dados.androidVinculadoEm };
}

export function situacaoDosLinks(dados: DadosDosLinks): SituacaoDosLinks {
  const ios = situacaoDoIos(dados);
  const android = situacaoDoAndroid(dados);

  let bloqueio: BloqueioDosLinks | null = null;
  if (dados.plataformaDaLoja === 'shopify') {
    if (!dados.shopifyConectada) {
      bloqueio = {
        tipo: 'conectar',
        motivo: 'Conecte a loja à Shopify em Integrações para os links abrirem no app.',
      };
    } else if (!dados.escoposDaLoja.includes(ESCOPO_DOS_LINKS)) {
      bloqueio =
        dados.conexao === 'manual'
          ? {
              tipo: 'reconectar',
              motivo: `O app que você criou na Shopify precisa da permissão ${ESCOPO_DOS_LINKS}, que a Shopify libera pelo suporte dela. Com ela liberada, reconecte a loja em Integrações.`,
            }
          : dados.storefyPedeOEscopo
            ? {
                tipo: 'reconectar',
                motivo:
                  'Falta uma permissão da Shopify para publicar os links. Reconecte a loja em Integrações para concedê-la.',
              }
            : {
                tipo: 'aguardando-shopify',
                motivo:
                  'A Shopify ainda está liberando esta função para a Storefy. Enquanto isso, os links da loja abrem no navegador, e o resto do app funciona normalmente.',
              };
    }
  }

  // Fora da Shopify não há o que mandar publicar: o lojista publica os
  // arquivos no próprio site (ver `arquivosDeAssociacao`).
  const podeVincular =
    dados.plataformaDaLoja === 'shopify' &&
    bloqueio === null &&
    (ios.estado !== 'falta' || android.estado !== 'falta');

  return { bloqueio, ios, android, podeVincular };
}

export interface ArquivosDeAssociacao {
  /** Conteúdo de `/.well-known/apple-app-site-association`, ou nulo. */
  apple: string | null;
  /** Conteúdo de `/.well-known/assetlinks.json`, ou nulo. */
  android: string | null;
}

/**
 * Os dois arquivos, prontos para o lojista de fora da Shopify publicar.
 *
 * Todos os caminhos da loja abrem no app: é a loja inteira que está lá dentro,
 * e o app já sabe levar cada caminho para a aba certa.
 */
export function arquivosDeAssociacao(dados: {
  appleTeamId: string | null;
  bundleIdIos: string | null;
  packageAndroid: string | null;
  impressoesAndroid: readonly string[];
}): ArquivosDeAssociacao {
  const appId = appIdDaApple(dados.appleTeamId, dados.bundleIdIos);
  const pacote = (dados.packageAndroid ?? '').trim();

  return {
    apple:
      appId === null
        ? null
        : JSON.stringify(
            { applinks: { details: [{ appIDs: [appId], components: [{ '/': '*' }] }] } },
            null,
            2,
          ),
    android:
      pacote === '' || dados.impressoesAndroid.length === 0
        ? null
        : JSON.stringify(
            [
              {
                relation: ['delegate_permission/common.handle_all_urls'],
                target: {
                  namespace: 'android_app',
                  package_name: pacote,
                  sha256_cert_fingerprints: [...dados.impressoesAndroid],
                },
              },
            ],
            null,
            2,
          ),
  };
}

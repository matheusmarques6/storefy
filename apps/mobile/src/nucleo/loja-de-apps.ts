/**
 * M11 — a ficha do app na loja de aplicativos.
 *
 * A atualização obrigatória sem um caminho até a loja é um beco: o cliente lê
 * "atualize", sai do app, abre a App Store, procura a loja pelo nome, acha (ou
 * não) e só então atualiza. Com o botão, é um toque.
 *
 * Dois endereços para cada loja: o do app da loja de aplicativos, que abre
 * direto na ficha, e o da web, para o aparelho em que ninguém atende o
 * primeiro — um Android sem Google Play, um simulador.
 */
import type { Ambiente } from './ambiente';

/**
 * Como o cliente chama a loja de aplicativos. No Android, "Play Store", que é
 * o nome embaixo do ícone no celular dele — e as duas pedem o mesmo artigo:
 * "abra a App Store", "abra a Play Store".
 */
export type LojaDeApps = 'App Store' | 'Play Store';

export interface FichaNaLoja {
  /** Abre o app da loja direto na ficha. */
  nativo: string;
  /** A mesma ficha, no navegador. */
  web: string;
}

export function lojaDaPlataforma(plataforma: 'ios' | 'android'): LojaDeApps {
  return plataforma === 'ios' ? 'App Store' : 'Play Store';
}

/**
 * Os textos da tela, para o cliente da loja: sem "ficha", sem "build", com o
 * nome do app como ele aparece no celular.
 */
export function textosDaAtualizacao(entrada: {
  plataforma: 'ios' | 'android';
  /** Há ficha para abrir (e, portanto, botão)? */
  temFicha: boolean;
  nomeDoApp: string;
}): { corpo: string; naoAbriu: string } {
  const loja = lojaDaPlataforma(entrada.plataforma);
  const app = entrada.nomeDoApp.trim() === '' ? 'este app' : entrada.nomeDoApp.trim();
  const procurar = `Abra a ${loja}, procure por ${app} e toque em Atualizar.`;
  return {
    corpo: entrada.temFicha
      ? `Esta versão ficou para trás. Atualize pela ${loja} para continuar comprando.`
      : `Esta versão ficou para trás. ${procurar}`,
    naoAbriu: `Não conseguimos abrir a ${loja}. ${procurar}`,
  };
}

/**
 * Os endereços da ficha deste app, ou `null` quando o build não sabe qual é
 * — e aí a tela diz onde procurar, em vez de mostrar um botão que não abriria
 * nada.
 */
export function fichaNaLoja(
  ambiente: Pick<Ambiente, 'appStoreId' | 'pacoteAndroid'>,
  plataforma: 'ios' | 'android',
): FichaNaLoja | null {
  if (plataforma === 'ios') {
    if (ambiente.appStoreId === null) return null;
    return {
      nativo: `itms-apps://apps.apple.com/app/id${ambiente.appStoreId}`,
      web: `https://apps.apple.com/app/id${ambiente.appStoreId}`,
    };
  }

  if (ambiente.pacoteAndroid === null) return null;
  const pacote = encodeURIComponent(ambiente.pacoteAndroid);
  return {
    nativo: `market://details?id=${pacote}`,
    web: `https://play.google.com/store/apps/details?id=${pacote}`,
  };
}

/**
 * Abre a ficha: o app da loja primeiro; se ninguém atende, o navegador.
 *
 * Devolve se alguma das duas abriu. `false` não é silêncio: a tela troca o
 * botão pela instrução de onde procurar.
 */
export async function abrirFicha(
  ficha: FichaNaLoja,
  abrir: (url: string) => Promise<unknown>,
): Promise<boolean> {
  for (const url of [ficha.nativo, ficha.web]) {
    try {
      await abrir(url);
      return true;
    } catch {
      // Ninguém atende este endereço neste aparelho: vale o próximo.
    }
  }
  return false;
}

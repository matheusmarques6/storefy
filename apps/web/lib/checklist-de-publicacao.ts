/**
 * O checklist que decide se um app pode ir para as lojas (C12 do plano).
 *
 * Existe porque uma rejeição da Apple custa DIAS. O revisor não responde em
 * minutos: um app enviado sem ícone de 1024 px volta rejeitado quatro dias
 * depois, e o lojista passou esses quatro dias achando que estava publicando.
 * Cada item aqui é algo que a Apple ou o Google recusam, e que dá para
 * conferir antes de gastar um build de vinte minutos.
 *
 * É função pura de propósito: o mesmo checklist decide o que a tela mostra e
 * se o botão de publicar funciona. Duas listas separadas divergiriam, e a
 * divergência apareceria como um botão habilitado que falha.
 */

export type Plataforma = 'ios' | 'android';

export interface EstadoDaPublicacao {
  /** Nome que vai aparecer embaixo do ícone no celular. */
  nomeDoApp: string;
  /** Versão da config publicada. `null` quando o lojista nunca publicou. */
  versaoPublicada: number | null;
  iconePronto: boolean;
  splashPronta: boolean;
  bundleIdIos: string | null;
  packageAndroid: string | null;
  appleConectada: boolean;
  googleConectada: boolean;
  /** Push é opcional para publicar, mas vale avisar. */
  pushLigado: boolean;
}

export interface ItemDoChecklist {
  chave: string;
  titulo: string;
  /** O que fazer, quando falta. */
  comoResolver: string;
  pronto: boolean;
  /** Impede a publicação, ou é só recomendação? */
  obrigatorio: boolean;
  /** Vale para qual plataforma? `null` quando vale para as duas. */
  plataforma: Plataforma | null;
  /** Para onde a tela manda o lojista. */
  caminho: string | null;
}

/**
 * O nome do app tem limite de 30 caracteres na App Store.
 *
 * Acima disso a Apple TRUNCA sem avisar, e o app vai para a loja com o nome
 * cortado no meio — que é como o cliente final vai encontrá-lo para sempre.
 */
export const MAXIMO_DO_NOME = 30;

export function montarChecklist(estado: EstadoDaPublicacao): ItemDoChecklist[] {
  const nome = estado.nomeDoApp.trim();

  return [
    {
      chave: 'nome',
      titulo: 'Nome do app definido',
      comoResolver:
        nome === ''
          ? 'Dê um nome ao app no editor. É o que aparece embaixo do ícone no celular.'
          : `O nome tem ${String(nome.length)} caracteres. A Apple corta em ${String(MAXIMO_DO_NOME)}, e o app vai para a loja com o nome cortado.`,
      pronto: nome !== '' && nome.length <= MAXIMO_DO_NOME,
      obrigatorio: true,
      plataforma: null,
      caminho: '/app',
    },
    {
      chave: 'config',
      titulo: 'Configuração publicada',
      comoResolver:
        'Publique o app no editor. O binário é gerado a partir da versão publicada, não do rascunho.',
      pronto: estado.versaoPublicada !== null,
      obrigatorio: true,
      plataforma: null,
      caminho: '/app',
    },
    {
      chave: 'icone',
      titulo: 'Ícone enviado',
      comoResolver:
        'Envie um ícone quadrado de 1024×1024, sem transparência e sem cantos arredondados — a Apple recusa os dois.',
      pronto: estado.iconePronto,
      obrigatorio: true,
      plataforma: null,
      caminho: '/app',
    },
    {
      chave: 'splash',
      titulo: 'Tela de abertura enviada',
      comoResolver: 'Envie a imagem que aparece enquanto o app abre.',
      pronto: estado.splashPronta,
      obrigatorio: true,
      plataforma: null,
      caminho: '/app',
    },
    {
      chave: 'apple',
      titulo: 'Conta Apple conectada',
      comoResolver:
        'Conecte a conta Apple da sua empresa. O app é publicado nela, não na conta da Storefy.',
      pronto: estado.appleConectada,
      obrigatorio: true,
      plataforma: 'ios',
      caminho: '/publicacao/contas',
    },
    {
      chave: 'bundle',
      titulo: 'Identificador do app (iOS)',
      comoResolver: 'A Storefy define este identificador ao criar o registro do app na Apple.',
      pronto: estado.bundleIdIos !== null && estado.bundleIdIos !== '',
      obrigatorio: true,
      plataforma: 'ios',
      caminho: null,
    },
    {
      chave: 'google',
      titulo: 'Conta Google conectada',
      comoResolver: 'Conecte a conta do Google Play da sua empresa.',
      pronto: estado.googleConectada,
      obrigatorio: true,
      plataforma: 'android',
      caminho: '/publicacao/contas',
    },
    {
      chave: 'package',
      titulo: 'Identificador do app (Android)',
      comoResolver: 'A Storefy define este identificador ao preparar o primeiro build.',
      pronto: estado.packageAndroid !== null && estado.packageAndroid !== '',
      obrigatorio: true,
      plataforma: 'android',
      caminho: null,
    },
    {
      chave: 'push',
      titulo: 'Notificações ligadas',
      comoResolver:
        'Dá para publicar sem, mas o app perde a ferramenta que mais traz cliente de volta.',
      pronto: estado.pushLigado,
      obrigatorio: false,
      plataforma: null,
      caminho: '/push',
    },
  ];
}

/** O checklist de UMA plataforma: os itens gerais mais os dela. */
export function checklistDaPlataforma(
  itens: readonly ItemDoChecklist[],
  plataforma: Plataforma,
): ItemDoChecklist[] {
  return itens.filter((item) => item.plataforma === null || item.plataforma === plataforma);
}

/** Dá para publicar nesta plataforma? Só os obrigatórios contam. */
export function podePublicar(itens: readonly ItemDoChecklist[], plataforma: Plataforma): boolean {
  return checklistDaPlataforma(itens, plataforma).every((item) => !item.obrigatorio || item.pronto);
}

/** O que falta, em ordem, para a tela listar. */
export function pendencias(
  itens: readonly ItemDoChecklist[],
  plataforma: Plataforma,
): ItemDoChecklist[] {
  return checklistDaPlataforma(itens, plataforma).filter(
    (item) => item.obrigatorio && !item.pronto,
  );
}

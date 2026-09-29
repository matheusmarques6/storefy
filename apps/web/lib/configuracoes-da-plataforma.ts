/**
 * As chaves de funcionamento da plataforma (A13), com o padrão de cada uma.
 *
 * O banco guarda só o que foi MUDADO (`platform_settings`): chave ausente vale
 * o padrão daqui. É o que deixa uma plataforma recém-instalada funcionar sem
 * seed nenhum — e o que faz uma linha apagada por engano voltar ao padrão, e
 * não a um estado indefinido.
 *
 * A leitura é tolerante de propósito: um valor de tipo errado vira o padrão.
 * Estas chaves são lidas em toda tela do painel e no cadastro; um JSON ruim
 * aqui não pode derrubar o painel de todos os lojistas.
 */
import type { Json } from '@storefy/db';
import { conferirVideo } from '@/lib/video-do-passo';

export interface ConfiguracoesDaPlataforma {
  /** O cadastro por e-mail aceita contas novas. */
  cadastroAberto: boolean;
  /** Frase no topo do painel de todos os lojistas. Vazio, nada aparece. */
  avisoNoPainel: string;
  /**
   * Onde baixar o app Storefy Preview, o que lê o QR da prévia (C04 e C06).
   * Vazio é "ainda não publicado": a tela diz isso em vez de um botão que leva
   * a lugar nenhum. O app é da Storefy e sai uma vez só (seção 9.4 do plano).
   */
  previaNoIphone: string;
  previaNoAndroid: string;
  /**
   * O vídeo do passo a passo de cada conta (C13), já no endereço de
   * incorporar do YouTube (sem cookies), do Vimeo ou do Loom. Vazio, o cartão
   * da conta fica só com os passos escritos.
   */
  videoDaApple: string;
  videoDoGoogle: string;
}

/** Onde baixar o Storefy Preview, como as telas do lojista recebem. Vazio é "ainda não". */
export interface OndeBaixarAPrevia {
  iphone: string;
  android: string;
}

export function ondeBaixarAPrevia(configuracoes: ConfiguracoesDaPlataforma): OndeBaixarAPrevia {
  return { iphone: configuracoes.previaNoIphone, android: configuracoes.previaNoAndroid };
}

export const PADRAO: ConfiguracoesDaPlataforma = {
  cadastroAberto: true,
  avisoNoPainel: '',
  previaNoIphone: '',
  previaNoAndroid: '',
  videoDaApple: '',
  videoDoGoogle: '',
};

/** O aviso tem de caber numa faixa: é uma frase, não um comunicado. */
export const TAMANHO_MAXIMO_DO_AVISO = 280;

/**
 * De onde o link de cada loja pode ser. O TestFlight entra porque é como um
 * app interno costuma sair primeiro para o iPhone; o teste interno do Google
 * Play mora no próprio `play.google.com`.
 */
const HOSTS_DA_PREVIA: Record<'iphone' | 'android', readonly string[]> = {
  iphone: ['apps.apple.com', 'testflight.apple.com'],
  android: ['play.google.com'],
};

export function lerConfiguracoes(
  linhas: readonly { chave: string; valor: Json }[],
): ConfiguracoesDaPlataforma {
  const valorDe = (chave: string): Json | undefined =>
    linhas.find((linha) => linha.chave === chave)?.valor;

  const cadastro = valorDe('cadastro_aberto');
  const aviso = valorDe('aviso_no_painel');

  return {
    cadastroAberto: typeof cadastro === 'boolean' ? cadastro : PADRAO.cadastroAberto,
    avisoNoPainel:
      typeof aviso === 'string'
        ? aviso.trim().slice(0, TAMANHO_MAXIMO_DO_AVISO)
        : PADRAO.avisoNoPainel,
    // Um link gravado que não passa mais na conferência vira "não publicado":
    // melhor do que um botão levando para outro lugar.
    previaNoIphone: linkGravado(valorDe('previa_no_iphone'), 'iphone'),
    previaNoAndroid: linkGravado(valorDe('previa_no_android'), 'android'),
    // O mesmo cuidado: um vídeo gravado que não passa mais vira "sem vídeo",
    // e não um iframe apontando para outro lugar.
    videoDaApple: videoGravado(valorDe('video_da_apple'), 'Apple'),
    videoDoGoogle: videoGravado(valorDe('video_do_google'), 'Google'),
  };
}

function videoGravado(valor: Json | undefined, conta: 'Apple' | 'Google'): string {
  if (typeof valor !== 'string') return '';
  const conferido = conferirVideo(valor, conta);
  return conferido.ok ? conferido.link : '';
}

function linkGravado(valor: Json | undefined, plataforma: 'iphone' | 'android'): string {
  if (typeof valor !== 'string') return '';
  const conferido = conferirLinkDaPrevia(valor, plataforma);
  return conferido.ok ? conferido.link : '';
}

/** O aviso digitado no admin, conferido. */
export function conferirAviso(
  bruto: string,
): { ok: true; aviso: string } | { ok: false; mensagem: string } {
  const aviso = bruto.trim().replace(/\s+/g, ' ');
  if (aviso.length > TAMANHO_MAXIMO_DO_AVISO) {
    return {
      ok: false,
      mensagem: `O aviso passa de ${String(TAMANHO_MAXIMO_DO_AVISO)} caracteres. Ele aparece numa faixa: resuma em uma frase.`,
    };
  }
  return { ok: true, aviso };
}

/**
 * O link do Storefy Preview digitado no admin, conferido.
 *
 * Só `https` e só o endereço da loja de aplicativos daquela plataforma: é um
 * botão que TODO lojista vai tocar, e um erro de colagem — o link do Android
 * no campo do iPhone, um endereço de rascunho — mandaria a base inteira para
 * o lugar errado. Vazio é válido: tira o botão.
 */
export function conferirLinkDaPrevia(
  bruto: string,
  plataforma: 'iphone' | 'android',
): { ok: true; link: string } | { ok: false; mensagem: string } {
  const texto = bruto.trim();
  if (texto === '') return { ok: true, link: '' };

  const loja = plataforma === 'iphone' ? 'App Store ou TestFlight' : 'Google Play';
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return { ok: false, mensagem: `O link do ${nomeDa(plataforma)} não é um endereço válido.` };
  }
  if (url.protocol !== 'https:' || !HOSTS_DA_PREVIA[plataforma].includes(url.hostname)) {
    return {
      ok: false,
      mensagem: `O link do ${nomeDa(plataforma)} precisa ser da ${loja}, começando com https://.`,
    };
  }
  return { ok: true, link: url.toString() };
}

function nomeDa(plataforma: 'iphone' | 'android'): string {
  return plataforma === 'iphone' ? 'iPhone' : 'Android';
}

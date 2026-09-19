/**
 * A sequência do push, da abertura do app ao evento de carrinho.
 *
 * Toda a orquestração está aqui, com o SDK e a API entrando por parâmetro,
 * porque a ORDEM é o que se erra: registrar o aparelho antes de existir um ID
 * de inscrição grava lixo; pedir permissão antes de o SDK iniciar não faz
 * nada; mandar evento de carrinho antes de haver aparelho registrado produz
 * um evento sem dono, que não agenda push nenhum.
 *
 * Nada daqui pode impedir a loja de abrir. O cliente veio comprar.
 */
import type { Notificador } from './onesignal.ts';
import type { Credenciais, Resultado, RespostaDoAparelho } from './api.ts';
import { registrarAparelho, enviarEventoDeCarrinho } from './api.ts';
import { tagsDaCompra, tagsDoApp, tagsDoCarrinho, type CarrinhoParaTag } from './tags.ts';
import { destinoDoPush, linkDaNotificacao, type DestinoDoPush } from './deep-link.ts';

export interface DependenciasDaSessao {
  notificador: Notificador;
  credenciais: Credenciais | null;
  plataforma: 'ios' | 'android';
  appVersion: string;
  /** App ID do OneSignal deste build. `null` desliga o push por inteiro. */
  oneSignalAppId: string | null;
}

export interface ResultadoDoInicio {
  /** O SDK foi iniciado? */
  iniciou: boolean;
  /** ID de inscrição deste aparelho, quando já existe. */
  inscricao: string | null;
  /** O aparelho foi registrado na Storefy? */
  registrou: boolean;
  /** Por que não, quando não. Vai para o log, não para a tela. */
  motivo?: string;
}

/**
 * Liga o push e registra o aparelho. Chamado uma vez, na abertura.
 *
 * A ordem é: inicia o SDK → pega o ID de inscrição → registra na Storefy. O ID
 * pode ainda não existir (o SDK conversa com o servidor do OneSignal antes de
 * ter um), e nesse caso o registro espera o `aoMudarInscricao` — registrar com
 * ID nulo criaria uma linha que nunca corresponde a aparelho nenhum.
 */
export async function iniciarPush(dependencias: DependenciasDaSessao): Promise<ResultadoDoInicio> {
  const { notificador, oneSignalAppId, credenciais } = dependencias;

  if (oneSignalAppId === null) {
    return { iniciou: false, inscricao: null, registrou: false, motivo: 'sem app do OneSignal' };
  }

  try {
    notificador.iniciar(oneSignalAppId);
  } catch {
    return { iniciou: false, inscricao: null, registrou: false, motivo: 'SDK não iniciou' };
  }

  // A versão do app vale desde já: ela não depende de permissão nenhuma, e é
  // o que evita mandar push de um recurso que a versão instalada não tem.
  try {
    notificador.marcar(tagsDoApp(dependencias.appVersion));
  } catch {
    /* Marcar tag é melhoria, não requisito. Não vale derrubar a abertura. */
  }

  let inscricao: string | null = null;
  try {
    inscricao = await notificador.idDaInscricao();
  } catch {
    inscricao = null;
  }

  if (inscricao === null) {
    return {
      iniciou: true,
      inscricao: null,
      registrou: false,
      motivo: 'inscrição ainda não existe',
    };
  }
  if (credenciais === null) {
    return { iniciou: true, inscricao, registrou: false, motivo: 'build sem credencial da API' };
  }

  const resposta = await registrarAparelho(credenciais, {
    subscriptionId: inscricao,
    platform: dependencias.plataforma,
    appVersion: dependencias.appVersion,
  });

  return {
    iniciou: true,
    inscricao,
    registrou: resposta.ok,
    motivo: resposta.ok ? undefined : resposta.motivo,
  };
}

/**
 * Registra o aparelho quando o ID de inscrição finalmente aparece.
 *
 * É o outro caminho: quem acabou de aceitar a notificação ganha um ID que não
 * existia na abertura. Sem isto, esse cliente só seria registrado na PRÓXIMA
 * vez que abrisse o app — e as campanhas de hoje não o alcançariam.
 */
export function registrarQuandoAssinar(
  dependencias: DependenciasDaSessao,
  aoRegistrar?: (resultado: Resultado<RespostaDoAparelho>) => void,
): void {
  const { notificador, credenciais } = dependencias;
  if (credenciais === null) return;

  notificador.aoMudarInscricao((id) => {
    if (id === null || id === '') return;
    void registrarAparelho(credenciais, {
      subscriptionId: id,
      platform: dependencias.plataforma,
      appVersion: dependencias.appVersion,
    }).then(
      (resultado) => {
        aoRegistrar?.(resultado);
      },
      () => {
        /* `registrarAparelho` já não lança; este ramo é cinto de segurança. */
      },
    );
  });
}

/**
 * Liga o toque na notificação à navegação.
 *
 * `urlDaLoja` e `dominios` vêm da config, e é por eles que um link de fora
 * vira "só abrir o app" em vez de uma WebView sem barra de endereço com a
 * cara da loja.
 */
export function ouvirToques(
  notificador: Notificador,
  loja: { urlDaLoja: string; dominios: readonly string[] },
  navegar: (destino: DestinoDoPush) => void,
): void {
  notificador.aoTocar((notificacao) => {
    navegar(destinoDoPush(linkDaNotificacao(notificacao), loja.urlDaLoja, loja.dominios));
  });
}

/**
 * O carrinho mudou: marca as tags e conta ao servidor.
 *
 * As duas coisas, e nesta ordem. A tag é o que a segmentação do lojista lê; o
 * evento é o que agenda (ou cancela) o carrinho abandonado. Fazer só uma
 * delas deixa metade do produto funcionando.
 */
export async function carrinhoMudou(
  dependencias: DependenciasDaSessao,
  inscricao: string | null,
  carrinho: CarrinhoParaTag & { token?: string; currency?: string },
): Promise<void> {
  try {
    dependencias.notificador.marcar(tagsDoCarrinho(carrinho));
  } catch {
    /* Sem tag o push ainda sai; sem evento, não. Seguir adiante. */
  }

  const { credenciais } = dependencias;
  if (credenciais === null || inscricao === null) return;

  await enviarEventoDeCarrinho(credenciais, {
    subscriptionId: inscricao,
    // `update` cobre tanto somar quanto tirar item; o servidor decide o que
    // fazer pelo `itemCount`, e é ele quem cancela quando chega zero.
    event: 'update',
    itemCount: Math.max(0, Math.trunc(carrinho.count)),
    cartToken: carrinho.token,
    valueCents: carrinho.totalCents,
    currency: carrinho.currency,
  });
}

/** O cliente foi para o checkout. */
export async function checkoutIniciado(
  dependencias: DependenciasDaSessao,
  inscricao: string | null,
  token: string,
  itemCount: number,
): Promise<void> {
  const { credenciais } = dependencias;
  if (credenciais === null || inscricao === null) return;

  await enviarEventoDeCarrinho(credenciais, {
    subscriptionId: inscricao,
    event: 'checkout_started',
    itemCount: Math.max(0, Math.trunc(itemCount)),
    cartToken: token,
  });
}

/**
 * O pedido foi concluído.
 *
 * Este é o evento que CANCELA o push de carrinho abandonado. Falhar aqui em
 * silêncio significa mandar "você esqueceu algo no carrinho" para quem acabou
 * de comprar — por isso quem chama recebe de volta se deu certo.
 */
export async function pedidoConcluido(
  dependencias: DependenciasDaSessao,
  inscricao: string | null,
  pedido: { totalCents: number; currency?: string },
): Promise<boolean> {
  try {
    dependencias.notificador.marcar(tagsDaCompra());
  } catch {
    /* A tag é para a segmentação; o cancelamento é o que não pode falhar. */
  }

  const { credenciais } = dependencias;
  if (credenciais === null || inscricao === null) return false;

  const resposta = await enviarEventoDeCarrinho(credenciais, {
    subscriptionId: inscricao,
    event: 'purchased',
    itemCount: 0,
    valueCents: Math.max(0, Math.trunc(pedido.totalCents)),
    currency: pedido.currency,
  });

  return resposta.ok;
}

/** O cliente entrou na conta da loja. */
export function identificarCliente(notificador: Notificador, customerId: string | undefined): void {
  const id = (customerId ?? '').trim();
  try {
    if (id === '') notificador.esquecerIdentificacao();
    else notificador.identificar(id);
  } catch {
    /* Identificar é o que permite falar com a PESSOA em vez do aparelho.
       Não conseguir é perda de alcance, não motivo para quebrar a loja. */
  }
}

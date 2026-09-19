/**
 * O que o app manda para a Storefy (seção 6 do plano).
 *
 * Dois endpoints, os únicos que o app escreve: `/api/public/devices` quando o
 * app abre, e `/api/public/events` quando o carrinho muda. Os dois são
 * assinados com o segredo deste build — sem sessão, porque quem está do outro
 * lado é o celular do cliente final.
 *
 * NADA AQUI PODE QUEBRAR O APP. Uma falha de rede ao registrar o aparelho não
 * pode impedir a loja de abrir: o cliente veio comprar, não receber push. Por
 * isso toda função devolve um resultado e nenhuma lança.
 */
import { hmacSha256, paraBytes, paraHex } from './hmac.ts';

/** O mesmo cabeçalho que o servidor confere. */
export const CABECALHO_DA_ASSINATURA = 'x-storefy-signature';

export interface Credenciais {
  /** Base da API da Storefy, sem barra no fim. */
  apiBase: string;
  /** ID do app na Storefy. */
  appId: string;
  /** Segredo deste build, embutido no binário. */
  segredo: string;
}

export interface DadosDoAparelho {
  subscriptionId: string;
  platform: 'ios' | 'android';
  appVersion?: string;
  /** `customerId` da loja, quando o cliente está logado. */
  externalId?: string;
}

export interface DadosDoEvento {
  subscriptionId: string;
  event: 'add' | 'update' | 'checkout_started' | 'purchased';
  itemCount: number;
  cartToken?: string;
  valueCents?: number;
  currency?: string;
}

/** Um aviso da caixa, como o servidor o entrega. */
export interface AvisoDaCaixa {
  id: string;
  title: string;
  body: string;
  deepLink: string | null;
  imagePath: string | null;
  /** ISO 8601, como o Postgres devolve. */
  sentAt: string;
}

export type Resultado<T> =
  | { ok: true; dados: T }
  | { ok: false; motivo: 'rede' | 'recusado' | 'limite' | 'servidor'; status?: number };

export interface RespostaDoAparelho {
  deviceId: string | null;
  novo: boolean;
  boasVindas: boolean;
}

export interface RespostaDoEvento {
  eventId: string | null;
  agendou: boolean;
  cancelou: number;
}

/**
 * Monta o cabeçalho de assinatura sobre o TEXTO do corpo.
 *
 * Sobre o texto, e não sobre o objeto: é esse texto que vai no `body`, e é
 * sobre ele que o servidor confere. Serializar duas vezes (uma para assinar,
 * outra para enviar) produziria textos diferentes em algum caso de ordem de
 * chaves, e a assinatura falharia sem explicação.
 */
export function assinar(segredo: string, quandoMs: number, corpo: string): string {
  const t = Math.floor(quandoMs / 1000);
  const digest = paraHex(hmacSha256(paraBytes(segredo), paraBytes(`${String(t)}.${corpo}`)));
  return `t=${String(t)},v1=${digest}`;
}

/** O `fetch` entra por parâmetro para o teste não precisar de rede. */
export type Buscador = typeof fetch;

interface Opcoes {
  buscador?: Buscador;
  agoraMs?: number;
  /** Corta a espera: um app travado esperando a API é pior do que sem push. */
  timeoutMs?: number;
}

const TIMEOUT_PADRAO = 10_000;

async function enviar<T>(
  credenciais: Credenciais,
  caminho: string,
  carga: Record<string, unknown>,
  opcoes: Opcoes,
): Promise<Resultado<T>> {
  const buscador = opcoes.buscador ?? fetch;
  const corpo = JSON.stringify({ appId: credenciais.appId, ...carga });
  const assinatura = assinar(credenciais.segredo, opcoes.agoraMs ?? Date.now(), corpo);

  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, opcoes.timeoutMs ?? TIMEOUT_PADRAO);

  try {
    const resposta = await buscador(`${credenciais.apiBase}${caminho}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [CABECALHO_DA_ASSINATURA]: assinatura },
      body: corpo,
      signal: controle.signal,
    });

    if (resposta.status === 429) return { ok: false, motivo: 'limite', status: 429 };
    if (resposta.status === 401 || resposta.status === 400) {
      // Assinatura ou corpo errados. Tentar de novo com os mesmos dados daria
      // no mesmo, então quem chama não deve reagendar.
      return { ok: false, motivo: 'recusado', status: resposta.status };
    }
    if (!resposta.ok) return { ok: false, motivo: 'servidor', status: resposta.status };

    return { ok: true, dados: (await resposta.json()) as T };
  } catch {
    // Rede caiu, tempo esgotou ou a resposta não era JSON. Nenhum desses é
    // motivo para o app parar de funcionar.
    return { ok: false, motivo: 'rede' };
  } finally {
    clearTimeout(relogio);
  }
}

/** Registra este aparelho. Chamado a cada abertura do app. */
export function registrarAparelho(
  credenciais: Credenciais,
  dados: DadosDoAparelho,
  opcoes: Opcoes = {},
): Promise<Resultado<RespostaDoAparelho>> {
  return enviar(credenciais, '/api/public/devices', { ...dados }, opcoes);
}

/** Conta o que aconteceu com o carrinho. */
export function enviarEventoDeCarrinho(
  credenciais: Credenciais,
  dados: DadosDoEvento,
  opcoes: Opcoes = {},
): Promise<Resultado<RespostaDoEvento>> {
  return enviar(credenciais, '/api/public/events', { ...dados }, opcoes);
}

/** Busca a caixa de avisos deste aparelho (M07). */
export function buscarCaixaDeAvisos(
  credenciais: Credenciais,
  subscriptionId: string,
  opcoes: Opcoes = {},
): Promise<Resultado<{ avisos: AvisoDaCaixa[] }>> {
  return enviar(credenciais, '/api/public/inbox', { subscriptionId }, opcoes);
}

/**
 * Há credenciais para falar com a API?
 *
 * Sem `appId`, sem `apiBase` ou sem segredo, o app funciona igual — só não
 * registra nem manda evento. É o estado de um `expo start` sem variáveis, e
 * de um build que ainda não passou pelo pipeline por loja.
 */
export function credenciaisDe(ambiente: {
  apiBase: string;
  appId: string | null;
  deviceSecret: string | null;
}): Credenciais | null {
  if (ambiente.appId === null || ambiente.deviceSecret === null) return null;
  const base = ambiente.apiBase.replace(/\/+$/, '');
  if (base === '') return null;
  return { apiBase: base, appId: ambiente.appId, segredo: ambiente.deviceSecret };
}

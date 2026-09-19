import 'server-only';

/**
 * O que o workflow de build recebe da Storefy (passo 3 da seção 7 do plano).
 *
 * O runner do GitHub Actions precisa da config publicada, dos assets e das
 * credenciais da loja para gerar e enviar o binário. Nada disso vai no
 * `client_payload` do dispatch — ele fica visível para quem tem acesso de
 * leitura às execuções do repositório. O workflow chega com o `buildId` e um
 * segredo, e busca o resto aqui.
 *
 * ESTA É A ROTA MAIS SENSÍVEL DO PRODUTO. Ela devolve, em claro, a chave que
 * publica na conta Apple de um cliente. Por isso:
 *
 *   o segredo é conferido em tempo constante, e sem ele a rota responde 503
 *   em vez de funcionar "por enquanto";
 *   a resposta é `no-store`, e o corpo nunca entra em log — nem o de erro;
 *   cada chamada só serve UM build, identificado por uuid, e só enquanto ele
 *   estiver na fila. Um buildId antigo não devolve credencial nenhuma.
 */
import { z } from 'zod';
import { iguaisEmTempoConstante } from '@/lib/cripto';

export const CABECALHO_DO_SEGREDO = 'authorization';

export const CorpoDoBuild = z.object({ buildId: z.uuid() });

export type Autorizacao = { ok: true } | { ok: false; status: number; motivo: string };

/**
 * Quem chamou é o nosso workflow?
 *
 * Sem `BUILD_API_SECRET` a resposta é NÃO, sempre. Uma rota que entrega
 * credenciais de cliente não pode ter um modo "ainda não configurei".
 */
export function autorizarWorkflow(
  cabecalho: string | null,
  segredo: string | undefined,
): Autorizacao {
  if (segredo == null || segredo === '') {
    return { ok: false, status: 503, motivo: 'BUILD_API_SECRET não configurado' };
  }

  const recebido = (cabecalho ?? '').trim();
  if (!iguaisEmTempoConstante(recebido, `Bearer ${segredo}`)) {
    return { ok: false, status: 401, motivo: 'segredo do build não confere' };
  }
  return { ok: true };
}

/** Os status em que faz sentido entregar credenciais. */
export const STATUS_QUE_PODEM_BUSCAR = ['queued', 'building'] as const;

export function podeBuscarCredenciais(status: string): boolean {
  return (STATUS_QUE_PODEM_BUSCAR as readonly string[]).includes(status);
}

export interface CredenciaisDoBuild {
  /** `.p8` da App Store Connect, em claro. */
  ascKey: string | null;
  ascKeyId: string | null;
  ascIssuerId: string | null;
  appleTeamId: string | null;
  /** JSON da conta de serviço do Google, em claro. */
  googleServiceAccount: string | null;
}

export interface DadosParaOBuild {
  buildId: string;
  storeId: string;
  appId: string;
  platform: 'ios' | 'android';
  profile: string;
  /** Nome que aparece embaixo do ícone. */
  nomeDoApp: string;
  bundleIdIos: string | null;
  packageAndroid: string | null;
  expoProjectId: string | null;
  oneSignalAppId: string | null;
  /** Segredo com que o app assina o que manda, em claro. */
  deviceSecret: string | null;
  /** Canal de EAS Update desta loja. */
  canal: string;
  corDeFundo: string;
  /** A config publicada, inteira. */
  config: unknown;
  /**
   * Links assinados do ícone e da tela de abertura.
   *
   * Assinados, e não caminhos: o bucket é privado, e dar ao runner a chave do
   * Storage seria dar acesso aos assets de TODAS as lojas. O link vale meia
   * hora, que é mais do que um build leva para baixá-lo.
   */
  urlDoIcone: string | null;
  urlDaSplash: string | null;
  credenciais: CredenciaisDoBuild;
}

/**
 * O canal de EAS Update de uma loja.
 *
 * Um canal por loja: uma correção OTA mandada para uma não pode vazar para as
 * outras. É o mesmo raciocínio do app na OneSignal.
 */
export function canalDaLoja(storeId: string, profile: string): string {
  return `${profile}-${storeId}`;
}

/**
 * Descriptografa sem deixar o erro contar o que falhou.
 *
 * Uma credencial ausente e uma credencial ilegível dão o mesmo `null` aqui: a
 * diferença só interessa ao log do servidor, e o workflow reclama igual nos
 * dois casos — sem a credencial ele não tem o que fazer.
 */
export function abrirOuNulo(
  cifrado: string | null,
  descriptografar: (valor: string) => string,
): string | null {
  if (cifrado == null || cifrado === '') return null;
  try {
    return descriptografar(cifrado);
  } catch {
    return null;
  }
}

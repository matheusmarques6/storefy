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
import type { Database } from '@storefy/db';
import { iguaisEmTempoConstante } from '@/lib/cripto';

type StatusDeBuild = Database['public']['Enums']['build_status'];

export const CABECALHO_DO_SEGREDO = 'authorization';

/**
 * O que o workflow manda.
 *
 * `etapa` separa as duas visitas do runner: a GERAÇÃO precisa da config, dos
 * assets e de tudo; o ENVIO precisa só da credencial da loja de aplicativos.
 * São dois momentos com riscos diferentes, e dar a mesma resposta aos dois
 * entregaria o segredo do app e a config inteira a quem só ia chamar o
 * `eas submit`.
 */
export const CorpoDoBuild = z.object({
  buildId: z.uuid(),
  etapa: z.enum(['build', 'submit']).default('build'),
});

export type Etapa = z.infer<typeof CorpoDoBuild>['etapa'];

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

/**
 * Os status em que faz sentido entregar credenciais, por etapa.
 *
 * A janela é curta de propósito, e é diferente em cada etapa: um `buildId`
 * vazado — ele viaja no `client_payload`, que é visível para quem lê as
 * execuções do repositório — só vale enquanto o build está naquele momento.
 * Um build aprovado não devolve credencial nenhuma.
 */
export const STATUS_QUE_PODEM_BUSCAR: Record<Etapa, readonly string[]> = {
  build: ['queued', 'building'],
  // O envio começa quando o binário fica pronto. `submitted` entra porque o
  // GitHub reexecuta workflow, e uma reexecução do envio não pode virar 404.
  submit: ['finished', 'submitted'],
};

export function podeBuscarCredenciais(status: string, etapa: Etapa = 'build'): boolean {
  return STATUS_QUE_PODEM_BUSCAR[etapa].includes(status);
}

/** O que o workflow pode dizer sobre um build. */
export type StatusDoWorkflow = 'building' | 'finished' | 'errored' | 'submitted';

/**
 * De quais status uma linha pode receber ESTE aviso.
 *
 * Uma lista só, larga, deixaria a etapa errada mexer na linha: o workflow de
 * geração poderia marcar como "gerando" um binário que já está pronto, e o de
 * envio poderia marcar como "enviado" um build que nunca gerou nada. A regra é
 * por aviso porque o risco é por aviso.
 *
 * `errored` é o mais largo de propósito: qualquer uma das duas etapas pode
 * falhar, e uma falha que não consegue ser registrada deixa o lojista olhando
 * para "gerando" até desistir.
 */
export function origensPermitidas(status: StatusDoWorkflow): readonly StatusDeBuild[] {
  switch (status) {
    case 'building':
    case 'finished':
      return ['queued', 'building'];
    case 'submitted':
      return ['finished'];
    case 'errored':
      return ['queued', 'building', 'finished'];
  }
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
 * O que o workflow de ENVIO recebe.
 *
 * Bem menos do que o de geração: nem config, nem segredo do app, nem link de
 * asset. Só o que o `eas submit` precisa para falar com a loja de aplicativos
 * em nome do lojista.
 */
export interface DadosParaOEnvio {
  buildId: string;
  storeId: string;
  platform: 'ios' | 'android';
  profile: string;
  /** Id do build no EAS: é por ele que o `eas submit` acha o binário. */
  easBuildId: string | null;
  bundleIdIos: string | null;
  packageAndroid: string | null;
  expoProjectId: string | null;
  nomeDoApp: string;
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

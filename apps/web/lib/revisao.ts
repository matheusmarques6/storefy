import 'server-only';

/**
 * O andamento da revisão da Apple (passo 6 da seção 7 do plano).
 *
 * Depois de o binário chegar à App Store Connect, quem decide é um revisor da
 * Apple, e isso leva de um a três dias. Não existe webhook para isso: a única
 * forma de saber é perguntar. Um cron de hora em hora é o bastante — a revisão
 * não muda de estado em minutos, e perguntar mais rápido só gasta cota.
 *
 * SÓ A APPLE. O envio ao Google vai para a trilha interna, que não passa por
 * revisão: ali `submitted` já é o estado final até o lojista promover a versão
 * para produção pelo Play Console. Inventar um `approved` para Android seria
 * dizer ao lojista que o app está no ar quando ele não está.
 */
import { BASE_DA_API, montarToken, type ChaveDaAppStore } from '@/lib/apple';

export type StatusDaRevisao = 'in_review' | 'approved' | 'rejected';

/**
 * Traduz o estado da versão na App Store para o nosso.
 *
 * A Apple tem quinze estados; três coisas interessam ao lojista: estão
 * olhando, passou, ou não passou. O resto — `PREPARE_FOR_SUBMISSION`,
 * `PROCESSING_FOR_APP_STORE`, `REPLACED_WITH_NEW_VERSION` — devolve `null`, e
 * a linha fica como está.
 *
 * `null` também para o que não conhecemos. A Apple acrescenta estado sem
 * avisar, e um estado novo virando "aprovado" por acidente diria ao lojista
 * que o app está na loja quando ninguém o revisou.
 */
export function traduzirEstadoDaApple(estado: string): StatusDaRevisao | null {
  switch (estado.trim().toUpperCase()) {
    case 'IN_REVIEW':
      return 'in_review';

    /*
     * `PENDING_DEVELOPER_RELEASE` conta como aprovado de propósito: a Apple já
     * disse sim, e o que falta é um clique do lojista. Deixá-lo em "em
     * revisão" esconderia justamente o momento em que ele precisa agir.
     */
    case 'READY_FOR_SALE':
    case 'PENDING_DEVELOPER_RELEASE':
    case 'PENDING_APPLE_RELEASE':
    case 'APPROVED':
      return 'approved';

    case 'REJECTED':
    case 'METADATA_REJECTED':
    case 'DEVELOPER_REJECTED':
    case 'INVALID_BINARY':
      return 'rejected';

    default:
      return null;
  }
}

/** O que o lojista lê quando a Apple decide. */
export function mensagemDaRevisao(status: StatusDaRevisao, estado: string): string | null {
  if (status !== 'rejected') return null;

  switch (estado.trim().toUpperCase()) {
    case 'METADATA_REJECTED':
      return 'A Apple recusou as informações da ficha do app (nome, descrição, capturas ou política de privacidade). Corrija no App Store Connect e envie de novo.';
    case 'INVALID_BINARY':
      return 'A Apple recusou o arquivo do app. Publique de novo por aqui; se repetir, fale com o suporte.';
    case 'DEVELOPER_REJECTED':
      return 'Esta versão foi retirada da revisão por alguém da sua equipe no App Store Connect.';
    default:
      return 'A Apple recusou esta versão. O motivo detalhado está no App Store Connect, em Resolution Center.';
  }
}

/**
 * O estado vindo da resposta da App Store Connect.
 *
 * `appStoreState` é o campo antigo e `appVersionState` o novo; qual deles vem
 * depende da versão da API que a conta recebe. Ler os dois custa duas linhas e
 * evita um cron que roda de hora em hora sem nunca achar nada.
 */
export function lerEstadoDaVersao(corpo: unknown): { estado: string; versao: string } | null {
  if (corpo === null || typeof corpo !== 'object') return null;

  const dados = (corpo as { data?: unknown }).data;
  if (!Array.isArray(dados)) return null;

  const primeira: unknown = dados[0];
  if (primeira === null || typeof primeira !== 'object') return null;

  const atributos: unknown = (primeira as { attributes?: unknown }).attributes;
  if (atributos === null || typeof atributos !== 'object') return null;

  const campos: {
    appStoreState?: unknown;
    appVersionState?: unknown;
    versionString?: unknown;
  } = atributos;

  const estado = campos.appStoreState ?? campos.appVersionState;
  if (typeof estado !== 'string' || estado === '') return null;

  const versao = campos.versionString;
  return { estado, versao: typeof versao === 'string' ? versao : '' };
}

/** O id do app na App Store Connect, a partir do bundle. */
export function lerIdDoApp(corpo: unknown): string | null {
  if (corpo === null || typeof corpo !== 'object') return null;

  const dados = (corpo as { data?: unknown }).data;
  if (!Array.isArray(dados)) return null;

  const primeiro: unknown = dados[0];
  if (primeiro === null || typeof primeiro !== 'object') return null;

  const id: unknown = (primeiro as { id?: unknown }).id;
  return typeof id === 'string' && id !== '' ? id : null;
}

const TIMEOUT_MS = 20_000;

export type ConsultaDaRevisao =
  | { ok: true; status: StatusDaRevisao | null; estado: string; versao: string }
  /** `passageiro` separa "a Apple está fora do ar" de "esta loja está errada". */
  | { ok: false; passageiro: boolean; motivo: string };

/**
 * Pergunta à Apple em que pé está a versão mais recente do app.
 *
 * São duas chamadas porque a App Store Connect não deixa filtrar versão por
 * bundle direto: primeiro o app, depois as versões dele.
 */
export async function consultarRevisao(
  chave: ChaveDaAppStore,
  bundleId: string,
  buscador: typeof fetch = fetch,
  agoraS: number = Math.floor(Date.now() / 1000),
): Promise<ConsultaDaRevisao> {
  let token: string;
  try {
    token = montarToken(chave, agoraS);
  } catch {
    return { ok: false, passageiro: false, motivo: 'A chave da Apple desta loja não funciona.' };
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  const pegar = async (caminho: string): Promise<{ status: number; corpo: unknown }> => {
    const resposta = await buscador(`${BASE_DA_API}${caminho}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controle.signal,
    });
    const texto = await resposta.text();
    let corpo: unknown = null;
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = null;
    }
    return { status: resposta.status, corpo };
  };

  try {
    const app = await pegar(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`);
    const falha = falhaDaApple(app.status);
    if (falha !== null) return falha;

    const appId = lerIdDoApp(app.corpo);
    if (appId === null) {
      return {
        ok: false,
        passageiro: false,
        motivo: 'Este app ainda não está cadastrado na sua conta da App Store Connect.',
      };
    }

    const versoes = await pegar(
      `/v1/apps/${appId}/appStoreVersions?limit=1&sort=-versionString&fields[appStoreVersions]=versionString,appStoreState,appVersionState`,
    );
    const falhaDaVersao = falhaDaApple(versoes.status);
    if (falhaDaVersao !== null) return falhaDaVersao;

    const lido = lerEstadoDaVersao(versoes.corpo);
    if (lido === null) {
      // App cadastrado e sem nenhuma versão ainda: não é erro, é cedo demais.
      return { ok: true, status: null, estado: '', versao: '' };
    }

    return {
      ok: true,
      status: traduzirEstadoDaApple(lido.estado),
      estado: lido.estado,
      versao: lido.versao,
    };
  } catch {
    return {
      ok: false,
      passageiro: true,
      motivo: 'Não conseguimos falar com a Apple agora.',
    };
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * A resposta da Apple é uma falha? Qual tipo?
 *
 * A diferença importa para o cron: uma falha PASSAGEIRA não pode virar erro na
 * tela do lojista, porque na hora seguinte o cron tenta de novo e resolve
 * sozinho. Uma permanente — chave revogada, papel insuficiente — precisa
 * aparecer, senão o build fica "enviado" para sempre.
 */
function falhaDaApple(status: number): { ok: false; passageiro: boolean; motivo: string } | null {
  if (status >= 200 && status < 300) return null;

  if (status === 401 || status === 403) {
    return {
      ok: false,
      passageiro: false,
      motivo:
        'A Apple não aceitou mais a chave desta loja. Reconecte a conta Apple para continuarmos acompanhando a revisão.',
    };
  }
  if (status === 429 || status >= 500) {
    return { ok: false, passageiro: true, motivo: 'A Apple está instável agora.' };
  }
  return { ok: false, passageiro: false, motivo: 'A Apple recusou a consulta desta loja.' };
}

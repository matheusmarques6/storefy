import 'server-only';

/**
 * Em que pé está o app na Play Store (C12 e A06).
 *
 * O envio automático vai para a trilha de TESTE INTERNO, que a Google não
 * revisa e nenhum cliente vê. Chegar aos clientes é outro passo, do lojista:
 * promover a versão para a PRODUÇÃO no Play Console — aí a Google revisa e
 * publica. Nenhum webhook avisa nada disso, então o job da revisão pergunta
 * de hora em hora, com a conta de serviço que o lojista conectou (C13):
 *
 *   1. as trilhas do app, por uma "edição" só de leitura, apagada em seguida
 *      (a API só mostra as trilhas dentro de uma edição);
 *   2. a página pública do app, que só existe depois de a Google publicar.
 *
 * O resultado vira `builds.store_state`, que a tela usa para dizer ao lojista
 * se falta um passo dele, da Google ou de ninguém.
 */
import { ESCOPO_DO_PLAY, URL_DO_TOKEN, lerContaDeServico, montarAssercao } from '@/lib/google';

export const BASE_DA_PLAY = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

/**
 * O estado da versão na Play, como `builds.store_state` guarda.
 *
 *   PLAY_INTERNAL          só no teste interno: falta o lojista promover;
 *   PLAY_PRODUCTION_DRAFT  a versão de produção foi criada e não enviada;
 *   PLAY_HALTED            o lançamento em produção foi interrompido;
 *   PLAY_PRODUCTION        enviada para a produção: a Google revisa e publica;
 *   PLAY_LIVE              em produção, com o app aberto a todos na Play Store;
 *   PLAY_REPLACED          uma versão mais nova já foi para a produção.
 */
export type EstadoNaPlay =
  | 'PLAY_INTERNAL'
  | 'PLAY_PRODUCTION_DRAFT'
  | 'PLAY_HALTED'
  | 'PLAY_PRODUCTION'
  | 'PLAY_LIVE'
  | 'PLAY_REPLACED';

export interface VersaoNaTrilha {
  /** `draft`, `inProgress`, `halted` ou `completed`, como a API devolve. */
  status: string;
  versionCodes: number[];
}

/** As versões da trilha de produção, na resposta de `edits.tracks.list`. */
export function lerTrilhaDeProducao(corpo: unknown): VersaoNaTrilha[] {
  if (corpo === null || typeof corpo !== 'object') return [];
  const trilhas: unknown = (corpo as { tracks?: unknown }).tracks;
  if (!Array.isArray(trilhas)) return [];

  const producao: unknown = trilhas.find(
    (trilha: unknown) =>
      trilha !== null &&
      typeof trilha === 'object' &&
      (trilha as { track?: unknown }).track === 'production',
  );
  if (producao === undefined || producao === null || typeof producao !== 'object') return [];

  const versoes: unknown = (producao as { releases?: unknown }).releases;
  if (!Array.isArray(versoes)) return [];

  const lidas: VersaoNaTrilha[] = [];
  for (const versao of versoes as unknown[]) {
    if (versao === null || typeof versao !== 'object') continue;
    const { status, versionCodes } = versao as { status?: unknown; versionCodes?: unknown };
    if (typeof status !== 'string') continue;
    const codigos = Array.isArray(versionCodes)
      ? (versionCodes as unknown[])
          .map((codigo) => (typeof codigo === 'string' ? Number(codigo) : codigo))
          .filter(
            (codigo): codigo is number => typeof codigo === 'number' && Number.isInteger(codigo),
          )
      : [];
    lidas.push({ status, versionCodes: codigos });
  }
  return lidas;
}

/**
 * O estado desta versão, pelo que a trilha de produção e a página pública dizem.
 *
 * `in_review` e `approved` são os status do build que o estado move; os outros
 * estados deixam o build onde está (`submitted`) — é o lojista quem age.
 *
 * "Aprovado" no Android é "em produção, com o app aberto na Play Store". Na
 * primeira versão isso é exatamente a aprovação da Google: a página pública só
 * existe depois dela. Numa atualização, a API não diz se a revisão daquela
 * versão acabou — e a tela fala "em produção", sem prometer que ela já chegou
 * a todos os celulares.
 */
export function estadoNaPlay(entrada: {
  producao: readonly VersaoNaTrilha[];
  versionCode: number;
  publicado: boolean;
}): { estado: EstadoNaPlay; status: 'in_review' | 'approved' | null } {
  const desta = entrada.producao.find((versao) =>
    versao.versionCodes.includes(entrada.versionCode),
  );

  if (desta === undefined) {
    const maisNova = entrada.producao.some(
      (versao) =>
        versao.status !== 'draft' &&
        versao.versionCodes.some((codigo) => codigo > entrada.versionCode),
    );
    return { estado: maisNova ? 'PLAY_REPLACED' : 'PLAY_INTERNAL', status: null };
  }

  if (desta.status === 'draft') return { estado: 'PLAY_PRODUCTION_DRAFT', status: null };
  if (desta.status === 'halted') return { estado: 'PLAY_HALTED', status: null };
  if (entrada.publicado) return { estado: 'PLAY_LIVE', status: 'approved' };
  return { estado: 'PLAY_PRODUCTION', status: 'in_review' };
}

export type ConsultaDaPlay =
  | { ok: true; estado: EstadoNaPlay; status: 'in_review' | 'approved' | null }
  /** `passageiro` separa "a Google está fora do ar" de "esta loja está errada". */
  | { ok: false; passageiro: boolean; motivo: string };

const TIMEOUT_MS = 20_000;

/**
 * Pergunta à Play onde está a versão `versionCode` do app `pacote`.
 *
 * A edição aberta para ler as trilhas é apagada no fim, dê certo ou não: uma
 * edição esquecida não publica nada, mas atrapalharia o lojista que abrisse
 * outra pelo Play Console na mesma hora.
 */
export async function consultarPlay(
  textoDaConta: string,
  pacote: string,
  versionCode: number,
  buscador: typeof fetch = fetch,
  agoraS: number = Math.floor(Date.now() / 1000),
): Promise<ConsultaDaPlay> {
  const leitura = lerContaDeServico(textoDaConta);
  if (!leitura.ok) {
    return {
      ok: false,
      passageiro: false,
      motivo: 'A conta do Google desta loja não abre mais. Reconecte a conta Google.',
    };
  }

  let assercao: string;
  try {
    assercao = montarAssercao(leitura.conta, ESCOPO_DO_PLAY, agoraS);
  } catch {
    return {
      ok: false,
      passageiro: false,
      motivo: 'A chave da conta do Google desta loja não funciona. Reconecte a conta Google.',
    };
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  let edicao: string | null = null;
  let token = '';
  const app = `${BASE_DA_PLAY}/applications/${encodeURIComponent(pacote)}`;

  try {
    const respostaDoToken = await buscador(URL_DO_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: assercao,
      }).toString(),
      signal: controle.signal,
    });
    const corpoDoToken = await lerJson(respostaDoToken);
    const acesso =
      corpoDoToken !== null && typeof corpoDoToken === 'object'
        ? (corpoDoToken as { access_token?: unknown }).access_token
        : undefined;
    if (!respostaDoToken.ok || typeof acesso !== 'string') {
      return falhaDaGoogle(respostaDoToken.status, 'token');
    }
    token = acesso;
    const autorizacao = { Authorization: `Bearer ${token}` };

    const respostaDaEdicao = await buscador(`${app}/edits`, {
      method: 'POST',
      headers: { ...autorizacao, 'Content-Type': 'application/json' },
      body: '{}',
      signal: controle.signal,
    });
    const corpoDaEdicao = await lerJson(respostaDaEdicao);
    const id =
      corpoDaEdicao !== null && typeof corpoDaEdicao === 'object'
        ? (corpoDaEdicao as { id?: unknown }).id
        : undefined;
    if (!respostaDaEdicao.ok || typeof id !== 'string' || id === '') {
      return falhaDaGoogle(respostaDaEdicao.status, 'app');
    }
    edicao = id;

    const respostaDasTrilhas = await buscador(`${app}/edits/${encodeURIComponent(id)}/tracks`, {
      headers: autorizacao,
      signal: controle.signal,
    });
    if (!respostaDasTrilhas.ok) return falhaDaGoogle(respostaDasTrilhas.status, 'app');
    const producao = lerTrilhaDeProducao(await lerJson(respostaDasTrilhas));

    // A página pública só importa quando a versão já foi para a produção.
    const enviada = producao.some(
      (versao) =>
        versao.versionCodes.includes(versionCode) &&
        (versao.status === 'completed' || versao.status === 'inProgress'),
    );
    let publicado = false;
    if (enviada) {
      const pagina = await buscador(
        `https://play.google.com/store/apps/details?id=${encodeURIComponent(pacote)}&hl=pt_BR`,
        { method: 'GET', redirect: 'follow', signal: controle.signal },
      );
      if (pagina.status >= 500) {
        return { ok: false, passageiro: true, motivo: 'A Play Store está instável agora.' };
      }
      publicado = pagina.ok;
    }

    return { ok: true, ...estadoNaPlay({ producao, versionCode, publicado }) };
  } catch {
    return { ok: false, passageiro: true, motivo: 'Não conseguimos falar com a Google agora.' };
  } finally {
    if (edicao !== null && token !== '') {
      try {
        await buscador(`${app}/edits/${encodeURIComponent(edicao)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Não apagou: a edição expira sozinha, e a consulta já tem a resposta.
      }
    }
    clearTimeout(relogio);
  }
}

async function lerJson(resposta: Response): Promise<unknown> {
  try {
    return JSON.parse(await resposta.text()) as unknown;
  } catch {
    return null;
  }
}

/**
 * A resposta da Google é uma falha? Qual tipo?
 *
 * Passageira (fora do ar, cota) não aparece para o lojista: a hora seguinte
 * tenta de novo. Permanente precisa aparecer, com o que fazer — senão o build
 * fica "no teste interno" para sempre e ninguém sabe por quê.
 */
function falhaDaGoogle(
  status: number,
  etapa: 'token' | 'app',
): { ok: false; passageiro: boolean; motivo: string } {
  if (status === 429 || status >= 500) {
    return { ok: false, passageiro: true, motivo: 'A Google está instável agora.' };
  }
  if (etapa === 'token') {
    return {
      ok: false,
      passageiro: false,
      motivo:
        'A Google não aceitou mais a conta de serviço desta loja. Reconecte a conta Google para continuarmos acompanhando a publicação.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      passageiro: false,
      motivo:
        'A conta de serviço não tem acesso a este app no Play Console. Em Usuários e permissões, dê a ela acesso ao app.',
    };
  }
  if (status === 404) {
    return {
      ok: false,
      passageiro: false,
      motivo: 'O Play Console ainda não tem este app. Faça o primeiro envio pelo Play Console.',
    };
  }
  return { ok: false, passageiro: false, motivo: 'A Google recusou a consulta desta loja.' };
}

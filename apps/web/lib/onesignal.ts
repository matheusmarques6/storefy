import 'server-only';

/**
 * O cliente da API da OneSignal (seção 6 do plano).
 *
 * Só o que o produto usa: criar uma notificação e ler as estatísticas dela. O
 * `fetch` entra por parâmetro para o teste não precisar de rede — e o teste
 * aqui importa mais do que o de costume, porque cada chamada destas manda uma
 * notificação de verdade para milhares de celulares.
 *
 * A chave REST é POR LOJA, decifrada logo antes da chamada e nunca guardada.
 */

export const BASE_DA_API = 'https://api.onesignal.com';

export interface CredenciaisDaOneSignal {
  appId: string;
  /** Chave REST da loja, já em claro. */
  chave: string;
}

export interface NotificacaoParaEnviar {
  title: string;
  body: string;
  /** Caminho na loja que o toque abre. */
  deepLink: string | null;
  /**
   * Filtros da OneSignal, vindos de `push_campaigns.segment`.
   * Vazio manda para todos os inscritos.
   */
  segment?: unknown;
  /** Quando presente, manda só para estas inscrições (envio de automação). */
  inscricoes?: readonly string[];
}

export type ResultadoDoEnvio =
  | { ok: true; notificationId: string; destinatarios: number | null }
  | { ok: false; motivo: string; permanente: boolean };

/**
 * Monta o corpo que a OneSignal espera.
 *
 * Separado do envio porque é a parte que se erra em silêncio: um campo com
 * nome trocado não dá erro, só entrega a notificação sem o link, ou para o
 * público errado.
 */
export function corpoDaNotificacao(
  credenciais: CredenciaisDaOneSignal,
  notificacao: NotificacaoParaEnviar,
): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    app_id: credenciais.appId,
    // `target_channel: push` é obrigatório desde a v16 da API. Sem ele, a
    // OneSignal recusa com um erro que não diz o que falta.
    target_channel: 'push',
    headings: { en: notificacao.title },
    contents: { en: notificacao.body },
  };

  /*
   * O caminho vai em `data.deep_link`, que é o que o app lê no toque. Não
   * usamos `url`: ele abre o NAVEGADOR do celular em vez do app, e o cliente
   * sai da loja para uma aba sem carrinho e sem login.
   */
  if (notificacao.deepLink !== null && notificacao.deepLink !== '') {
    corpo.data = { deep_link: notificacao.deepLink };
  }

  if (notificacao.inscricoes !== undefined && notificacao.inscricoes.length > 0) {
    corpo.include_subscription_ids = [...notificacao.inscricoes];
    return corpo;
  }

  const filtros = filtrosDoSegmento(notificacao.segment);
  if (filtros !== null) {
    corpo.filters = filtros;
    return corpo;
  }

  corpo.included_segments = ['Subscribed Users'];
  return corpo;
}

/**
 * Converte o `segment` guardado na campanha em filtros da OneSignal.
 *
 * `null` quer dizer "sem segmento", e então a campanha vai para todo mundo.
 * Um segmento que não dá para traduzir também vira `null` — e é de propósito:
 * o alternativo seria mandar um filtro que a OneSignal interpreta de outro
 * jeito, o que entrega a oferta errada para as pessoas erradas.
 */
export function filtrosDoSegmento(segment: unknown): Record<string, unknown>[] | null {
  if (segment === null || typeof segment !== 'object' || Array.isArray(segment)) return null;

  const entradas = Object.entries(segment as Record<string, unknown>).filter(
    ([chave, valor]) => chave !== '' && typeof valor === 'string' && valor !== '',
  );
  if (entradas.length === 0) return null;

  const filtros: Record<string, unknown>[] = [];
  for (const [chave, valor] of entradas) {
    if (filtros.length > 0) filtros.push({ operator: 'AND' });
    filtros.push({ field: 'tag', key: chave, relation: '=', value: valor });
  }
  return filtros;
}

/** Quanto esperar antes de desistir de uma chamada. */
const TIMEOUT_MS = 20_000;

/**
 * Manda a notificação.
 *
 * `permanente` diz a quem chama se vale a pena tentar de novo. Chave errada
 * não melhora com repetição; rede caindo, sim — e repetir o que não vai
 * melhorar só gasta a cota da loja e atrasa a fila.
 */
export async function enviarNotificacao(
  credenciais: CredenciaisDaOneSignal,
  notificacao: NotificacaoParaEnviar,
  buscador: typeof fetch = fetch,
): Promise<ResultadoDoEnvio> {
  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  try {
    const resposta = await buscador(`${BASE_DA_API}/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${credenciais.chave}`,
      },
      body: JSON.stringify(corpoDaNotificacao(credenciais, notificacao)),
      signal: controle.signal,
    });

    const texto = await resposta.text();
    return lerRespostaDoEnvio(resposta.status, texto);
  } catch {
    return {
      ok: false,
      motivo: 'Não conseguimos falar com o servidor de push.',
      permanente: false,
    };
  } finally {
    clearTimeout(relogio);
  }
}

/** Interpreta a resposta da OneSignal. Separado para poder ser testado. */
export function lerRespostaDoEnvio(status: number, texto: string): ResultadoDoEnvio {
  let corpo: Record<string, unknown>;
  try {
    const lido: unknown = JSON.parse(texto);
    corpo = lido !== null && typeof lido === 'object' ? (lido as Record<string, unknown>) : {};
  } catch {
    return {
      ok: false,
      motivo: 'O servidor de push respondeu algo inesperado.',
      // 2xx com corpo ilegível é bizarro o bastante para não repetir às cegas:
      // pode ter enviado, e repetir mandaria a campanha duas vezes.
      permanente: status >= 200 && status < 300,
    };
  }

  const erros = corpo.errors;

  if (status >= 200 && status < 300) {
    const id = corpo.id;
    if (typeof id === 'string' && id !== '') {
      const destinatarios = corpo.recipients;
      return {
        ok: true,
        notificationId: id,
        destinatarios: typeof destinatarios === 'number' ? destinatarios : null,
      };
    }

    /*
     * 200 sem `id` é o caso de "nenhum destinatário": a OneSignal aceita a
     * chamada e não cria notificação nenhuma. Não é erro de configuração, e
     * repetir não muda nada — a campanha simplesmente não tinha público.
     */
    return {
      ok: false,
      motivo: mensagemDoErro(erros) ?? 'Nenhum aparelho recebeu.',
      permanente: true,
    };
  }

  // 401/403 é chave errada; 400 é corpo errado. Repetir não conserta nenhum.
  const permanente = status === 400 || status === 401 || status === 403 || status === 404;
  return {
    ok: false,
    motivo: mensagemDoErro(erros) ?? `O servidor de push recusou (${String(status)}).`,
    permanente,
  };
}

/** A OneSignal manda `errors` ora como lista, ora como objeto por campo. */
function mensagemDoErro(erros: unknown): string | null {
  const textoUtil = (item: unknown): item is string => typeof item === 'string' && item !== '';

  if (Array.isArray(erros)) {
    return (erros as unknown[]).find(textoUtil) ?? null;
  }
  if (erros !== null && typeof erros === 'object') {
    const valores: unknown[] = Object.values(erros as Record<string, unknown>).flat();
    return valores.find(textoUtil) ?? null;
  }
  return null;
}

/** As estatísticas que a tela C10 mostra. */
export interface EstatisticasDaNotificacao {
  enviados: number | null;
  entregues: number | null;
  abertos: number | null;
  falhas: number | null;
}

/**
 * Lê as estatísticas de uma notificação já enviada.
 *
 * O que não vier da OneSignal fica `null`, e a tela mostra traço — nunca zero.
 * Um zero inventado aqui faria o lojista achar que a campanha não abriu.
 */
export async function buscarEstatisticas(
  credenciais: CredenciaisDaOneSignal,
  notificationId: string,
  buscador: typeof fetch = fetch,
): Promise<EstatisticasDaNotificacao | null> {
  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  try {
    const url = `${BASE_DA_API}/notifications/${encodeURIComponent(notificationId)}?app_id=${encodeURIComponent(credenciais.appId)}`;
    const resposta = await buscador(url, {
      headers: { Authorization: `Key ${credenciais.chave}` },
      signal: controle.signal,
    });

    if (!resposta.ok) return null;
    return lerEstatisticas(await resposta.text());
  } catch {
    return null;
  } finally {
    clearTimeout(relogio);
  }
}

export function lerEstatisticas(texto: string): EstatisticasDaNotificacao | null {
  let corpo: Record<string, unknown>;
  try {
    const lido: unknown = JSON.parse(texto);
    if (lido === null || typeof lido !== 'object') return null;
    corpo = lido as Record<string, unknown>;
  } catch {
    return null;
  }

  return {
    enviados: inteiro(corpo.successful ?? corpo.recipients),
    entregues: inteiro(corpo.successful),
    abertos: inteiro(corpo.converted),
    falhas: inteiro(corpo.failed ?? corpo.errored),
  };
}

function inteiro(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0
    ? Math.trunc(valor)
    : null;
}

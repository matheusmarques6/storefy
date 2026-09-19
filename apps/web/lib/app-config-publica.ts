/**
 * A decisão por trás de `GET /api/public/app-config/[appId]` (seção 4 do plano).
 *
 * É o endpoint mais exposto do produto: todo app de todo cliente bate aqui em
 * toda abertura, sem sessão e sem quem defenda do outro lado. Por isso a
 * decisão mora aqui, separada do IO, e tem teste — o que este arquivo devolve
 * vira cabeçalho de CDN e resposta para milhares de aparelhos.
 *
 * O CORPO É A `AppConfig` CRUA, sem envelope. É o que `buscarNaRede` do app
 * entrega direto ao `decidirConfig`; um `{ data: ... }` em volta faria a config
 * ser descartada como inválida, e o app abriria com a versão embutida para
 * sempre, sem erro nenhum aparecendo.
 */
import { safeParseAppConfig, type AppConfig } from '@storefy/config-schema';

/** Linha de `app_configs` com status `published`. */
export interface LinhaPublicada {
  config: unknown;
  version: number;
}

export interface RespostaDaConfig {
  status: 200 | 304 | 400 | 404 | 500 | 503;
  /** Corpo da resposta. `null` no 304, que por definição não tem corpo. */
  corpo: AppConfig | { erro: string } | null;
  cabecalhos: Record<string, string>;
}

/**
 * Quanto tempo a CDN guarda cada resposta.
 *
 * Sessenta segundos é o teto de atraso entre o lojista clicar em publicar e a
 * mudança chegar. Curto o bastante para ele não achar que não funcionou, longo
 * o bastante para a origem não receber uma requisição por abertura de app.
 *
 * O 404 vale menos tempo: é o estado de quem ainda não publicou, e é exatamente
 * quem está prestes a publicar. O 400 vale muito: um id malformado não vira
 * válido com o tempo.
 */
const CACHE = {
  ok: 'public, s-maxage=60, stale-while-revalidate=300',
  semConfig: 'public, s-maxage=10',
  idInvalido: 'public, s-maxage=3600',
  // Erro nosso nunca é guardado: seria repetir a falha por horas.
  falha: 'no-store',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(valor: string): boolean {
  return UUID.test(valor.trim());
}

/** ETag da versão publicada. Fraca: o corpo é o mesmo JSON, não byte a byte. */
export function etagDaVersao(versao: number): string {
  return `W/"v${String(versao)}"`;
}

/**
 * O `If-None-Match` pode trazer uma lista, e um `*`.
 *
 * O app manda uma etag só, mas proxy e CDN no meio do caminho reescrevem o
 * cabeçalho. Comparar a string inteira faria o 304 nunca acontecer quando há
 * um deles no caminho — e aí todo aparelho baixaria a config toda vez.
 */
export function etagConfere(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  const bruto = ifNoneMatch.trim();
  if (bruto === '') return false;
  if (bruto === '*') return true;

  return bruto
    .split(',')
    .map((parte) => parte.trim())
    .some((parte) => parte === etag || parte === etag.replace(/^W\//, ''));
}

export interface EntradaDaResposta {
  /** `appId` como veio na URL. */
  appId: string;
  /** Cabeçalho `If-None-Match` da requisição. */
  ifNoneMatch: string | null;
  /**
   * O servidor tem tudo o que precisa para consultar o banco?
   *
   * Um booleano só, e não uma lista do que falta: a resposta é pública, e dizer
   * qual variável está ausente é informação de graça para quem estiver olhando.
   */
  servidorPronto: boolean;
  /** Linha publicada, ou `null` quando não há nenhuma. */
  linha: LinhaPublicada | null;
  /** Houve falha ao consultar o banco. */
  falhaNoBanco?: boolean;
}

export function montarResposta(entrada: EntradaDaResposta): RespostaDaConfig {
  if (!ehUuid(entrada.appId)) {
    return {
      status: 400,
      corpo: { erro: 'Identificador de app inválido.' },
      cabecalhos: { 'Cache-Control': CACHE.idInvalido },
    };
  }

  if (!entrada.servidorPronto) {
    return {
      status: 503,
      corpo: { erro: 'Servidor sem configuração de banco de dados.' },
      cabecalhos: { 'Cache-Control': CACHE.falha },
    };
  }

  if (entrada.falhaNoBanco === true) {
    return {
      status: 503,
      corpo: { erro: 'Não foi possível consultar a configuração agora.' },
      cabecalhos: { 'Cache-Control': CACHE.falha },
    };
  }

  if (entrada.linha === null) {
    return {
      status: 404,
      corpo: { erro: 'Nenhuma configuração publicada para este app.' },
      cabecalhos: { 'Cache-Control': CACHE.semConfig },
    };
  }

  const analise = safeParseAppConfig(entrada.linha.config);
  if (!analise.success) {
    /*
     * A config foi validada na publicação, então chegar aqui inválida significa
     * corrupção no banco ou uma mudança de schema que quebrou a compatibilidade
     * — justamente o que a regra 4 das regras técnicas existe para impedir.
     * Devolver assim mesmo faria todo app da loja abrir quebrado; melhor deixar
     * cair na config embutida, que ao menos funciona.
     */
    return {
      status: 500,
      corpo: { erro: 'A configuração publicada não é válida.' },
      cabecalhos: { 'Cache-Control': CACHE.falha },
    };
  }

  const etag = etagDaVersao(entrada.linha.version);
  const cabecalhos = { 'Cache-Control': CACHE.ok, ETag: etag };

  if (etagConfere(entrada.ifNoneMatch, etag)) {
    return { status: 304, corpo: null, cabecalhos };
  }

  return { status: 200, corpo: analise.data, cabecalhos };
}

import 'server-only';

/**
 * Buscar um endereço da internet que alguém de fora escolheu (C02 e C03).
 *
 * A detecção da loja e o logo do site saem do NOSSO servidor para um endereço
 * digitado no painel. `redirect: 'follow'` deixava um site público mandar
 * essa requisição, com um 302, para `169.254.169.254` ou `localhost` — o SSRF
 * clássico. Aqui cada salto é conferido com `ehHostPublico` antes de ser
 * seguido, e a resposta tem teto de tamanho e de tempo.
 */
import { ehHostPublico } from '@/lib/preview-proxy';

/** Quantos redirecionamentos seguir. Loja de verdade usa um ou dois. */
const MAXIMO_DE_SALTOS = 5;

export type FalhaDaBusca =
  /** O endereço (ou um salto dele) não é público. */
  | 'host'
  /** Redirecionamento demais, ou sem destino. */
  | 'saltos'
  /** A resposta passou do teto. */
  | 'grande'
  /** Rede, tempo esgotado, DNS. */
  | 'rede'
  /** O servidor respondeu com erro. */
  | 'status';

export type ResultadoDaBusca =
  | { ok: true; urlFinal: URL; tipo: string; corpo: Uint8Array }
  | { ok: false; falha: FalhaDaBusca; status?: number };

export interface OpcoesDaBusca {
  aceitar: string;
  tamanhoMaximo: number;
  tempoLimiteMs: number;
  agente: string;
  buscador?: typeof fetch;
}

export async function buscarPublico(url: URL, opcoes: OpcoesDaBusca): Promise<ResultadoDaBusca> {
  const buscador = opcoes.buscador ?? fetch;
  const cancelador = new AbortController();
  const alarme = setTimeout(() => {
    cancelador.abort();
  }, opcoes.tempoLimiteMs);

  try {
    let atual = url;
    for (let salto = 0; salto <= MAXIMO_DE_SALTOS; salto += 1) {
      if (
        (atual.protocol !== 'http:' && atual.protocol !== 'https:') ||
        !ehHostPublico(atual.hostname)
      ) {
        return { ok: false, falha: 'host' };
      }

      let resposta: Response;
      try {
        resposta = await buscador(atual.toString(), {
          signal: cancelador.signal,
          redirect: 'manual',
          headers: { 'User-Agent': opcoes.agente, Accept: opcoes.aceitar },
        });
      } catch {
        return { ok: false, falha: 'rede' };
      }

      if (resposta.status >= 300 && resposta.status < 400) {
        const destino = resposta.headers.get('location');
        if (destino === null || destino === '') return { ok: false, falha: 'saltos' };
        try {
          atual = new URL(destino, atual);
        } catch {
          return { ok: false, falha: 'saltos' };
        }
        continue;
      }

      if (!resposta.ok) return { ok: false, falha: 'status', status: resposta.status };

      const declarado = Number(resposta.headers.get('content-length') ?? '0');
      if (declarado > opcoes.tamanhoMaximo) return { ok: false, falha: 'grande' };

      let corpo: ArrayBuffer;
      try {
        corpo = await resposta.arrayBuffer();
      } catch {
        return { ok: false, falha: 'rede' };
      }
      if (corpo.byteLength > opcoes.tamanhoMaximo) return { ok: false, falha: 'grande' };

      return {
        ok: true,
        urlFinal: atual,
        tipo: (resposta.headers.get('content-type') ?? '').toLowerCase(),
        corpo: new Uint8Array(corpo),
      };
    }
    return { ok: false, falha: 'saltos' };
  } finally {
    clearTimeout(alarme);
  }
}

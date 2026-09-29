/**
 * Erros que acontecem no navegador de quem usa o painel (Fase 8).
 *
 * O servidor relata os erros dele sozinho (`instrumentation.ts`); o que quebra
 * só no navegador — um componente que estoura ao desenhar, uma promessa sem
 * `catch` — ninguém veria. Este arquivo decide O QUE vale mandar e monta o
 * pacote; a rota `/api/erros` repassa ao Sentry, se ele estiver configurado.
 *
 * O QUE NÃO VAI:
 *   - erro que já tem `digest`: veio do servidor, que já relatou;
 *   - erro de extensão do navegador e o "Script error." de outro domínio: não
 *     são nossos, e encheriam o alarme de ruído que ninguém resolve;
 *   - a query da página: pode carregar o token de um convite;
 *   - o mesmo erro duas vezes na mesma página, e mais de cinco no total.
 *
 * Sem `server-only`: roda no navegador.
 */

export type OndeAconteceu = 'janela' | 'promessa' | 'tela';

export interface ErroDoNavegador {
  tipo: string;
  mensagem: string;
  pilha?: string;
  /** Só o caminho, sem query nem fragmento. */
  pagina: string;
  onde: OndeAconteceu;
}

export const LIMITES_DO_ERRO = { tipo: 100, mensagem: 500, pilha: 5000, pagina: 300 } as const;

/** Barulho conhecido, que não é defeito do produto. */
const RUIDO = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  // Navegação do Next, que ele mesmo trata.
  /NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK/,
  // A pessoa perdeu a internet no meio: a tela já diz isso.
  /^(Failed to fetch|NetworkError when attempting to fetch resource\.|Load failed)$/i,
];

const DE_EXTENSAO = /(chrome|moz|safari(-web)?)-extension:\/\//;

/** O erro vale ser mandado? E, se vale, como fica o pacote. */
export function montarErroDoNavegador(
  erro: unknown,
  onde: OndeAconteceu,
  pagina: string,
): ErroDoNavegador | null {
  if (erro !== null && typeof erro === 'object' && 'digest' in erro) return null;

  const tipo = erro instanceof Error ? erro.name : 'Error';
  const mensagem = (erro instanceof Error ? erro.message : String(erro)).trim();
  const pilha = erro instanceof Error ? erro.stack : undefined;

  if (mensagem === '' || RUIDO.some((padrao) => padrao.test(mensagem))) return null;
  if (pilha !== undefined && DE_EXTENSAO.test(pilha)) return null;

  const caminho = pagina.split(/[?#]/, 1)[0] ?? '/';
  return {
    tipo: tipo.slice(0, LIMITES_DO_ERRO.tipo),
    mensagem: mensagem.slice(0, LIMITES_DO_ERRO.mensagem),
    ...(pilha === undefined ? {} : { pilha: pilha.slice(0, LIMITES_DO_ERRO.pilha) }),
    pagina: (caminho.startsWith('/') ? caminho : '/').slice(0, LIMITES_DO_ERRO.pagina),
    onde,
  };
}

/** Quantos erros uma página manda, no máximo, até ser recarregada. */
export const MAXIMO_POR_PAGINA = 5;

/**
 * O relator de uma página: lembra o que já mandou. `enviar` é injetado para o
 * teste; no navegador, é o `sendBeacon`.
 */
export function criarRelator(enviar: (corpo: string) => void) {
  const vistos = new Set<string>();
  return (erro: unknown, onde: OndeAconteceu, pagina: string): boolean => {
    const pacote = montarErroDoNavegador(erro, onde, pagina);
    if (pacote === null) return false;
    const chave = `${pacote.tipo}:${pacote.mensagem}`;
    if (vistos.has(chave) || vistos.size >= MAXIMO_POR_PAGINA) return false;
    vistos.add(chave);
    try {
      enviar(JSON.stringify(pacote));
    } catch {
      // Relatar um erro não pode virar outro.
    }
    return true;
  };
}

function enviarPeloNavegador(corpo: string): void {
  const url = '/api/erros';
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    if (navigator.sendBeacon(url, new Blob([corpo], { type: 'application/json' }))) return;
  }
  void fetch(url, {
    method: 'POST',
    body: corpo,
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
  }).catch(() => undefined);
}

/** O relator do navegador, um só por carregamento de página. */
export const relatarNoNavegador = criarRelator(enviarPeloNavegador);

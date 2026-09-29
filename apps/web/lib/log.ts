/**
 * Logs estruturados (Fase 8).
 *
 * Uma linha de JSON por acontecimento: é o que a Vercel mostra, o que um
 * coletor de logs (log drain) entende sem expressão regular, e o que dá para
 * filtrar por `evento` quando alguma coisa parou de funcionar às três da
 * manhã. Texto solto como "[webhook] deu ruim" só serve a quem o escreveu.
 *
 * NADA SENSÍVEL SAI DAQUI. Chave com cara de segredo (token, senha, chave,
 * cookie, cabeçalho de autorização, coluna `_enc`) vira "[oculto]" antes de a
 * linha ser montada, em qualquer profundidade — um `log.erro('x', { resposta })`
 * descuidado não pode despejar o token da Shopify no painel da Vercel.
 *
 * Sem `server-only` de propósito: é função pura sobre `console`, e o teste
 * roda sem precisar de ambiente de servidor.
 */

export type Nivel = 'info' | 'aviso' | 'erro';

/** Nomes de campo que nunca aparecem num log, em qualquer nível. */
const SENSIVEL =
  /(token|secret|segredo|senha|password|authorization|cookie|chave|api[-_]?key|_enc$|dsn|assinatura|signature)/i;

/** Texto longo é cortado: um corpo de resposta inteiro não cabe numa linha útil. */
const MAX_TEXTO = 1000;
const MAX_PROFUNDIDADE = 4;
const MAX_ITENS = 20;

/** O erro como dado: nome, mensagem e as primeiras linhas da pilha. */
export function descreverErro(erro: unknown): Record<string, unknown> {
  if (erro instanceof Error) {
    const pilha = (erro.stack ?? '')
      .split('\n')
      .slice(1, 8)
      .map((linha) => linha.trim());
    const digest = (erro as { digest?: unknown }).digest;
    return {
      nome: erro.name,
      mensagem: cortar(erro.message),
      ...(pilha.length > 0 ? { pilha } : {}),
      ...(typeof digest === 'string' ? { digest } : {}),
    };
  }
  return { mensagem: cortar(String(erro)) };
}

function cortar(texto: string): string {
  return texto.length <= MAX_TEXTO ? texto : `${texto.slice(0, MAX_TEXTO)}…`;
}

/** Copia o valor tirando o que é sensível, cortando o que é grande. */
export function limpar(valor: unknown, profundidade = 0): unknown {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === 'string') return cortar(valor);
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'bigint') return valor.toString();
  if (valor instanceof Error) return descreverErro(valor);
  if (valor instanceof Date) return valor.toISOString();
  if (profundidade >= MAX_PROFUNDIDADE) return '[…]';

  if (Array.isArray(valor)) {
    return valor.slice(0, MAX_ITENS).map((item) => limpar(item, profundidade + 1));
  }
  if (typeof valor === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [chave, item] of Object.entries(valor)) {
      saida[chave] = SENSIVEL.test(chave) ? '[oculto]' : limpar(item, profundidade + 1);
    }
    return saida;
  }
  // Função, símbolo: não é dado.
  return `[${typeof valor}]`;
}

/** A linha, pronta para o console. Exportada para o teste conferir o formato. */
export function montarLinha(
  nivel: Nivel,
  evento: string,
  dados: Record<string, unknown> = {},
  agora: Date = new Date(),
): string {
  const limpos = limpar(dados) as Record<string, unknown>;
  // `nivel`, `evento` e `em` vêm por último: um campo de mesmo nome nos dados
  // não pode disfarçar um erro de informação.
  return JSON.stringify({ ...limpos, nivel, evento, em: agora.toISOString() });
}

function registrar(nivel: Nivel, evento: string, dados?: Record<string, unknown>): void {
  const linha = montarLinha(nivel, evento, dados);
  if (nivel === 'erro') console.error(linha);
  else if (nivel === 'aviso') console.warn(linha);
  else console.info(linha);
}

/**
 * `evento` é um nome estável, em `área.acontecimento` (`webhook-shopify.assinatura-invalida`):
 * é por ele que se filtra. A frase para gente vai em `dados.mensagem`, se precisar.
 */
export const log = {
  info: (evento: string, dados?: Record<string, unknown>): void => {
    registrar('info', evento, dados);
  },
  aviso: (evento: string, dados?: Record<string, unknown>): void => {
    registrar('aviso', evento, dados);
  },
  erro: (evento: string, dados?: Record<string, unknown>): void => {
    registrar('erro', evento, dados);
  },
};

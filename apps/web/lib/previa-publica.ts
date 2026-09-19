/**
 * A decisão de `GET /api/public/preview-config/[token]` (fase 2).
 *
 * É irmão do endpoint da config publicada, com uma diferença que muda tudo:
 * aqui sai o RASCUNHO, que ainda não passou pelo olhar de ninguém. Por isso o
 * acesso é por código temporário em vez de pelo id do app, a resposta nunca é
 * guardada em cache, e o código vence sozinho.
 */
import { createHash } from 'node:crypto';
import {
  ehTokenDePrevia,
  normalizarTokenDePrevia,
  safeParseAppConfig,
  type AppConfig,
} from '@storefy/config-schema';

export interface RespostaDaPrevia {
  status: 200 | 400 | 404 | 500 | 503;
  corpo: AppConfig | { erro: string } | null;
  cabecalhos: Record<string, string>;
}

/** O rascunho muda a cada salvar; guardar a resposta mostraria o anterior. */
const SEM_CACHE = 'no-store';

export { ehTokenDePrevia } from '@storefy/config-schema';

/**
 * O hash guardado no banco.
 *
 * O código viaja na URL e aparece no QR; o banco guarda só o hash, para um
 * vazamento de banco não virar acesso aos rascunhos de todos os clientes.
 */
export function hashDoToken(token: string): string {
  return createHash('sha256').update(normalizarTokenDePrevia(token)).digest('hex');
}

export interface EntradaDaPrevia {
  token: string;
  servidorPronto: boolean;
  /** Config do rascunho, quando o código é válido e está no prazo. */
  config: unknown;
  falhaNoBanco?: boolean;
}

export function montarRespostaDaPrevia(entrada: EntradaDaPrevia): RespostaDaPrevia {
  const cabecalhos = { 'Cache-Control': SEM_CACHE };

  if (!ehTokenDePrevia(entrada.token)) {
    return { status: 400, corpo: { erro: 'Código de prévia inválido.' }, cabecalhos };
  }
  if (!entrada.servidorPronto || entrada.falhaNoBanco === true) {
    return { status: 503, corpo: { erro: 'Não foi possível abrir a prévia agora.' }, cabecalhos };
  }
  if (entrada.config == null) {
    /*
     * Código errado, vencido e app sem rascunho dão a MESMA resposta. Separar
     * os casos contaria a quem está tentando adivinhar quais códigos existem.
     */
    return {
      status: 404,
      corpo: { erro: 'Esta prévia não existe mais. Gere um código novo no painel.' },
      cabecalhos,
    };
  }

  const analise = safeParseAppConfig(entrada.config);
  if (!analise.success) {
    return {
      status: 500,
      corpo: { erro: 'O rascunho tem um problema de configuração.' },
      cabecalhos,
    };
  }

  return { status: 200, corpo: analise.data, cabecalhos };
}

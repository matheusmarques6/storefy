/**
 * Erros para o Sentry, sem o SDK (Fase 8).
 *
 * POR QUE SEM O SDK: o `@sentry/nextjs` embrulha o build, o servidor e o
 * navegador, e cada versão do Next muda o jeito de fazer isso — o painel roda
 * num Next que o SDK ainda não acompanha. O que precisamos é pouco e estável:
 * mandar um erro, com contexto, para a API de "envelopes" do Sentry, que é o
 * mesmo formato que o próprio SDK usa por baixo.
 *
 * SEM `SENTRY_DSN`, NADA ACONTECE — e a A13 mostra "não configurado". O erro
 * continua indo para o log estruturado de qualquer jeito: o Sentry é o
 * alarme, o log é o registro.
 *
 * O que vai: tipo, mensagem, pilha, onde aconteceu e marcas (rota, loja,
 * plataforma). O que não vai: corpo de requisição, cabeçalho, cookie, e-mail.
 * Os dados extras passam pelo mesmo `limpar` dos logs.
 */
import { descreverErro, limpar, log } from '@/lib/log';

/** As partes do DSN que a API usa. */
export interface Dsn {
  chavePublica: string;
  /** `https://o123.ingest.sentry.io` */
  origem: string;
  projeto: string;
  /** O DSN inteiro, que vai no cabeçalho do envelope. */
  bruto: string;
}

/** `https://<chave>@<host>/<projeto>`. Qualquer outra coisa é "não configurado". */
export function lerDsn(texto: string | undefined): Dsn | null {
  const bruto = (texto ?? '').trim();
  if (bruto === '') return null;
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const partes = url.pathname.split('/').filter((parte) => parte !== '');
  const projeto = partes.at(-1) ?? '';
  if (url.username === '' || !/^\d+$/.test(projeto)) return null;
  // Um prefixo de caminho antes do projeto (Sentry próprio atrás de proxy)
  // continua valendo.
  const prefixo = partes.slice(0, -1).join('/');
  return {
    chavePublica: url.username,
    origem: `${url.protocol}//${url.host}${prefixo === '' ? '' : `/${prefixo}`}`,
    projeto,
    bruto,
  };
}

export function sentryConfigurado(): boolean {
  return lerDsn(process.env.SENTRY_DSN) !== null;
}

export interface QuadroDaPilha {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

/**
 * A pilha do V8 como o Sentry a quer: do mais antigo para o mais novo.
 * Linha que não se reconhece é pulada, e não inventada.
 *
 * O app roda no Hermes, que escreve `at salvar (address at index.android.bundle:1:2345)`
 * no build de produção: o "address at" sai, e fica o arquivo.
 */
export function quadrosDaPilha(pilha: string | undefined): QuadroDaPilha[] {
  if (pilha === undefined) return [];
  const quadros: QuadroDaPilha[] = [];
  for (const linha of pilha.split('\n').slice(1, 51)) {
    const casou =
      /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(linha) ??
      /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/.exec(linha);
    if (casou === null) continue;
    const [, funcao, bruto, linhaDoArquivo, coluna] = casou;
    const arquivo = bruto?.replace(/^address at /, '');
    if (arquivo === undefined || arquivo === '') continue;
    quadros.push({
      ...(funcao !== undefined && funcao !== '' ? { function: funcao } : {}),
      filename: arquivo,
      lineno: Number(linhaDoArquivo),
      colno: Number(coluna),
      in_app: !arquivo.includes('node_modules'),
    });
  }
  return quadros.reverse();
}

export interface ErroParaRelatar {
  erro: unknown;
  /** Onde: `app` (painel), `mobile`, `job`, `webhook`… Vira marca. */
  origem: string;
  /** Marcas curtas para filtrar no Sentry: rota, loja, plataforma. */
  marcas?: Record<string, string>;
  /** Contexto a mais, limpo antes de sair. */
  extras?: Record<string, unknown>;
  nivel?: 'error' | 'warning';
}

/** 32 caracteres hexadecimais, como o Sentry exige. */
function novoId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** O envelope completo: cabeçalho, cabeçalho do item e o evento. */
export function montarEnvelope(
  dsn: Dsn,
  entrada: ErroParaRelatar,
  ambiente: { release?: string; environment?: string },
  agora: Date = new Date(),
): string {
  const id = novoId();
  const erro = entrada.erro;
  const tipo = erro instanceof Error ? erro.name : 'Error';
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  const pilha = erro instanceof Error ? erro.stack : undefined;
  const digest =
    erro !== null && typeof erro === 'object' && 'digest' in erro ? String(erro.digest) : undefined;

  const evento = {
    event_id: id,
    timestamp: agora.getTime() / 1000,
    platform: 'javascript',
    level: entrada.nivel ?? 'error',
    logger: entrada.origem,
    ...(ambiente.release === undefined ? {} : { release: ambiente.release }),
    environment: ambiente.environment ?? 'production',
    exception: {
      values: [
        {
          type: tipo,
          value: mensagem.slice(0, 1000),
          ...(pilha === undefined ? {} : { stacktrace: { frames: quadrosDaPilha(pilha) } }),
        },
      ],
    },
    tags: {
      origem: entrada.origem,
      ...(digest === undefined ? {} : { digest }),
      ...entrada.marcas,
    },
    extra: limpar(entrada.extras ?? {}),
  };

  return [
    JSON.stringify({ event_id: id, sent_at: agora.toISOString(), dsn: dsn.bruto }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(evento),
  ].join('\n');
}

/**
 * Manda o erro. Nunca lança: quem relata um erro não pode ganhar outro.
 * Devolve se o Sentry aceitou, para o teste e para quem quiser saber.
 */
export async function relatarErro(
  entrada: ErroParaRelatar,
  buscador: typeof fetch = fetch,
): Promise<boolean> {
  const dsn = lerDsn(process.env.SENTRY_DSN);
  if (dsn === null) return false;

  const corpo = montarEnvelope(dsn, entrada, {
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    environment: process.env.VERCEL_ENV,
  });

  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, 3000);
  try {
    const resposta = await buscador(`${dsn.origem}/api/${dsn.projeto}/envelope/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=storefy/1.0, sentry_key=${dsn.chavePublica}`,
      },
      body: corpo,
      signal: controle.signal,
    });
    if (!resposta.ok) {
      // 429 é a cota do Sentry; 401/403, o DSN errado. Nos dois, o erro em si
      // já está no log de quem chamou.
      log.aviso('sentry.recusou', { status: resposta.status });
    }
    return resposta.ok;
  } catch (erro) {
    log.aviso('sentry.inalcancavel', { motivo: descreverErro(erro) });
    return false;
  } finally {
    clearTimeout(relogio);
  }
}

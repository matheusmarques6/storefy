import 'server-only';

/**
 * A decisão dos dois endpoints que o app escreve (seção 6 do plano).
 *
 * `POST /api/public/devices` e `POST /api/public/events` são as únicas rotas do
 * produto que aceitam escrita sem sessão: quem fala ali é o app instalado no
 * celular do cliente final da loja. Toda a lógica de decidir mora aqui, separada
 * das rotas, porque é o que precisa de teste — a rota vira quatro linhas.
 *
 * O caminho de uma requisição é sempre o mesmo:
 *
 *   1. o corpo é lido como TEXTO e a assinatura é conferida sobre esse texto
 *      exato. Conferir sobre o objeto já parseado deixaria passar duas cargas
 *      diferentes com o mesmo JSON, que é a brecha clássica desse padrão;
 *   2. o formato é validado com Zod, e o que não bate é recusado antes de
 *      chegar ao banco;
 *   3. uma função do Postgres faz o resto numa transação só.
 *
 * A RESPOSTA NUNCA EXPLICA A RECUSA. "assinatura válida mas fora da janela"
 * conta a quem está tentando que o segredo está certo, e isso é meio caminho
 * de um ataque de repetição. O motivo vai para o nosso log; o app recebe 401.
 */
import { z } from 'zod';
import { conferirAssinatura, CABECALHO_DA_ASSINATURA } from '@/lib/assinatura';
import { descriptografar, criptografiaConfigurada } from '@/lib/cripto';

/** O maior corpo que aceitamos. Um evento de carrinho cabe em muito menos. */
export const TAMANHO_MAXIMO = 4096;

const uuid = z.uuid({ message: 'appId inválido' });

/**
 * O id de inscrição do OneSignal.
 *
 * Limitado no tamanho porque ele entra numa coluna indexada: sem teto, um corpo
 * de 4 KB de inscrição faria o índice crescer por requisição.
 */
const inscricao = z.string().trim().min(1).max(128);

export const CorpoDoAparelho = z.object({
  appId: uuid,
  subscriptionId: inscricao,
  platform: z.enum(['ios', 'android']),
  appVersion: z.string().trim().min(1).max(32).optional(),
  externalId: z.string().trim().min(1).max(128).optional(),
  /** Hash do e-mail, nunca o e-mail (regra 3 do CLAUDE.md). Hex de sha256. */
  emailHash: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/, { message: 'emailHash deve ser um sha256 em hexadecimal' })
    .optional(),
});

export const CorpoDoEvento = z.object({
  appId: uuid,
  subscriptionId: inscricao,
  event: z.enum(['add', 'update', 'checkout_started', 'purchased']),
  itemCount: z.int().min(0).max(100_000),
  cartToken: z.string().trim().min(1).max(128).optional(),
  valueCents: z.int().min(0).optional(),
  currency: z.string().trim().length(3).optional(),
});

export const CorpoDaCaixa = z.object({
  appId: uuid,
  subscriptionId: inscricao,
});

/**
 * O pedido de "me avise quando voltar".
 *
 * `path` é conferido aqui e não só no bridge: o corpo chega pela rede, e quem
 * assina a requisição é o app — mas o conteúdo veio da página do lojista. Um
 * `//evil.com` guardado aqui viraria o link de uma notificação que abre outro
 * site dentro do app, dias depois, sem ninguém ligar uma coisa à outra.
 */
export const CorpoDoAviso = z.object({
  appId: uuid,
  subscriptionId: inscricao,
  variantId: z.string().trim().min(1).max(64),
  path: z
    .string()
    .trim()
    .startsWith('/')
    .max(500)
    .refine((valor) => !/^\/[/\\]/.test(valor), {
      message: 'Caminho relativo a protocolo abriria outro site.',
    })
    .optional(),
});

export type DadosDoAparelho = z.infer<typeof CorpoDoAparelho>;
export type DadosDoEvento = z.infer<typeof CorpoDoEvento>;
export type DadosDoAviso = z.infer<typeof CorpoDoAviso>;

export interface Resposta {
  status: number;
  corpo: Record<string, unknown>;
  /** Só para o log do servidor. Nunca vai para o corpo da resposta. */
  motivo?: string;
}

/** Cabeçalhos comuns. Nada aqui pode ser cacheado por ninguém. */
export const CABECALHOS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

/**
 * O que a rota precisa saber sobre o app para conferir a assinatura.
 *
 * `null` quando o app não existe. É de propósito que a resposta seja a mesma de
 * assinatura errada: responder 404 para app inexistente e 401 para assinatura
 * inválida transforma o endpoint num verificador de quais lojas existem.
 */
export type BuscarSegredo = (appId: string) => Promise<string | null>;

export interface Autorizado<T> {
  ok: true;
  dados: T;
}

export type Autorizacao<T> = Autorizado<T> | { ok: false; resposta: Resposta };

const NEGADO: Resposta = { status: 401, corpo: { erro: 'nao_autorizado' } };

function negar(motivo: string): { ok: false; resposta: Resposta } {
  return { ok: false, resposta: { ...NEGADO, motivo } };
}

/**
 * Lê, valida e autentica. Devolve os dados ou a resposta pronta de recusa.
 *
 * `agoraMs` e `buscarSegredo` entram por parâmetro para o teste controlar o
 * relógio e o banco — uma assinatura vencida só é testável se o tempo for
 * um valor, e não uma leitura de `Date.now()` escondida no meio.
 */
export async function autorizar<T extends { appId: string }>(
  esquema: z.ZodType<T>,
  corpoBruto: string,
  cabecalhoDaAssinatura: string | null,
  buscarSegredo: BuscarSegredo,
  agoraMs: number,
): Promise<Autorizacao<T>> {
  if (corpoBruto.length > TAMANHO_MAXIMO) {
    return { ok: false, resposta: { status: 413, corpo: { erro: 'corpo_grande_demais' } } };
  }

  if (!criptografiaConfigurada()) {
    /*
     * Sem ENCRYPTION_KEY não há como ler o segredo do app, e aceitar sem
     * conferir seria pior do que recusar: qualquer um escreveria em qualquer
     * loja. 503 porque o problema é do servidor, e o app deve tentar de novo.
     */
    return {
      ok: false,
      resposta: {
        status: 503,
        corpo: { erro: 'servidor_nao_configurado' },
        motivo: 'ENCRYPTION_KEY ausente',
      },
    };
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(corpoBruto);
  } catch {
    return { ok: false, resposta: { status: 400, corpo: { erro: 'json_invalido' } } };
  }

  const analise = esquema.safeParse(bruto);
  if (!analise.success) {
    /*
     * Aqui o detalhe PODE sair: é o app do próprio cliente mandando errado, e
     * sem a mensagem quem estiver integrando fica no escuro. Nada do que vai
     * aqui depende de segredo — são nomes de campo do corpo que ele enviou.
     */
    return {
      ok: false,
      resposta: {
        status: 400,
        corpo: {
          erro: 'corpo_invalido',
          campos: analise.error.issues.map((q) => q.path.join('.')).filter((c) => c !== ''),
        },
      },
    };
  }

  const dados = analise.data;

  let segredo: string | null;
  try {
    segredo = await buscarSegredo(dados.appId);
  } catch {
    return {
      ok: false,
      resposta: {
        status: 503,
        corpo: { erro: 'indisponivel' },
        motivo: 'falha ao buscar o segredo do app',
      },
    };
  }

  if (segredo === null) return negar('app não encontrado ou sem segredo');

  let emClaro: string;
  try {
    emClaro = descriptografar(segredo);
  } catch {
    return negar('segredo do app não pôde ser lido');
  }

  const conferencia = conferirAssinatura(cabecalhoDaAssinatura, emClaro, corpoBruto, agoraMs);
  if (!conferencia.ok) return negar(conferencia.motivo);

  return { ok: true, dados: analise.data };
}

/** O nome do cabeçalho, reexportado para a rota não importar dois módulos. */
export { CABECALHO_DA_ASSINATURA };

/*
 * O retorno das funções do Postgres também é validado.
 *
 * Os tipos gerados dizem `boolean | null` para toda coluna de um `returns
 * table`, porque é o que o Postgres permite. Ler esses nulos como `false`
 * seria inventar resposta: "não foi limitado" e "a função não disse" viram a
 * mesma coisa, e um bug na função apareceria como funcionamento normal. Aqui,
 * uma linha fora do formato vira 503 — erro do servidor, que é o que é.
 */
const LinhaDoAparelho = z.object({
  device_id: z.uuid().nullable(),
  limitado: z.boolean(),
  novo: z.boolean(),
  boas_vindas: z.boolean(),
});

const LinhaDoEvento = z.object({
  event_id: z.uuid().nullable(),
  limitado: z.boolean(),
  agendou: z.boolean(),
  cancelou: z.int().min(0),
});

const INDISPONIVEL: Resposta = {
  status: 503,
  corpo: { erro: 'indisponivel' },
  motivo: 'a função do banco devolveu algo fora do formato',
};

/**
 * Um aviso da caixa, como o app o recebe.
 *
 * Validado na saída porque o que sai daqui é desenhado na tela de um cliente
 * final: um `title` nulo viraria um card vazio, e um aviso pela metade é pior
 * do que aviso nenhum — a lista simplesmente não o inclui.
 */
const AvisoDaCaixa = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  body: z.string().min(1),
  deep_link: z.string().nullable(),
  image_path: z.string().nullable(),
  sent_at: z.string(),
});

export function lerCaixaDeAvisos(dados: unknown): Resposta {
  if (!Array.isArray(dados)) return INDISPONIVEL;

  const avisos = dados
    .map((linha) => AvisoDaCaixa.safeParse(linha))
    .filter((analise) => analise.success)
    .map((analise) => ({
      id: analise.data.id,
      title: analise.data.title,
      body: analise.data.body,
      deepLink: analise.data.deep_link,
      imagePath: analise.data.image_path,
      sentAt: analise.data.sent_at,
    }));

  return { status: 200, corpo: { avisos } };
}

/** A primeira linha do retorno, validada, ou a resposta de indisponível. */
export function lerLinhaDoAparelho(dados: unknown): Resposta {
  const analise = LinhaDoAparelho.safeParse(primeira(dados));
  return analise.success ? respostaDoAparelho(analise.data) : INDISPONIVEL;
}

/** O mesmo para o evento de carrinho. */
export function lerLinhaDoEvento(dados: unknown): Resposta {
  const analise = LinhaDoEvento.safeParse(primeira(dados));
  return analise.success ? respostaDoEvento(analise.data) : INDISPONIVEL;
}

/**
 * O supabase-js devolve array para `returns table` e objeto para `.single()`.
 * As duas formas chegam aqui, e nenhuma delas é erro.
 */
function primeira(dados: unknown): unknown {
  return Array.isArray(dados) ? dados[0] : dados;
}

/**
 * Traduz o retorno de `registrar_aparelho` em resposta HTTP.
 *
 * `limitado` vira 429 e não 200: o app precisa saber que deve esperar, senão
 * um aparelho que caiu no limite ficaria sem registro e sem nunca tentar de
 * novo — e um aparelho sem registro é um cliente que nunca recebe push.
 */
export function respostaDoAparelho(linha: {
  device_id: string | null;
  limitado: boolean;
  novo: boolean;
  boas_vindas: boolean;
}): Resposta {
  if (linha.limitado) {
    return { status: 429, corpo: { erro: 'muitas_requisicoes' }, motivo: 'limite por app' };
  }
  return {
    status: 200,
    corpo: { deviceId: linha.device_id, novo: linha.novo, boasVindas: linha.boas_vindas },
  };
}

/** O mesmo para `registrar_evento_de_carrinho`. */
export function respostaDoEvento(linha: {
  event_id: string | null;
  limitado: boolean;
  agendou: boolean;
  cancelou: number;
}): Resposta {
  if (linha.limitado) {
    return { status: 429, corpo: { erro: 'muitas_requisicoes' }, motivo: 'limite por app' };
  }
  return {
    status: 200,
    corpo: { eventId: linha.event_id, agendou: linha.agendou, cancelou: linha.cancelou },
  };
}

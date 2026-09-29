import 'server-only';

/**
 * Validação das credenciais da Apple (assistente C13 do plano).
 *
 * O lojista envia uma App Store Connect API Key — um arquivo `.p8`, um Key ID
 * e um Issuer ID — e a Storefy usa isso para criar o registro do app, mandar o
 * build e acompanhar a revisão. É a credencial mais poderosa que ele nos dá.
 *
 * POR QUE VALIDAR NA HORA DO UPLOAD: sem isso, um arquivo errado só apareceria
 * como erro no fim de um build de vinte minutos, dias depois, com uma mensagem
 * do EAS que o lojista não sabe ler. Validar é chamar a própria API da Apple
 * com a chave e ver se ela responde.
 *
 * A assinatura é ES256, que é o que a App Store Connect exige. O Node sabe
 * fazer isso; o que ele NÃO faz sozinho é o último passo: `createSign` devolve
 * a assinatura em DER, e o JOSE quer os dois números crus, de 32 bytes cada.
 * Entregar DER ali dá "401 sem explicação", que é o erro mais caro de depurar
 * nesta API.
 */
import { createSign, createPrivateKey, type KeyObject } from 'node:crypto';

export const BASE_DA_API = 'https://api.appstoreconnect.apple.com';

export interface ChaveDaAppStore {
  /** Conteúdo do arquivo `.p8`, como o lojista enviou. */
  p8: string;
  keyId: string;
  issuerId: string;
}

/**
 * Quanto tempo o token vale.
 *
 * A Apple recusa qualquer coisa acima de 20 minutos. Usamos poucos minutos: o
 * token é feito na hora de cada chamada, e um prazo curto reduz o estrago de
 * um vazamento de log.
 */
export const VALIDADE_DO_TOKEN_S = 5 * 60;

/** O `.p8` parece mesmo uma chave privada? Recusa antes de tentar assinar. */
export function pareceChaveP8(conteudo: string): boolean {
  const texto = conteudo.trim();
  return (
    texto.startsWith('-----BEGIN PRIVATE KEY-----') &&
    texto.includes('-----END PRIVATE KEY-----') &&
    texto.length > 100
  );
}

function base64url(dados: Buffer | string): string {
  return Buffer.from(dados).toString('base64url');
}

/**
 * Converte a assinatura DER que o Node produz no formato cru do JOSE.
 *
 * DER é uma estrutura: SEQUENCE { INTEGER r, INTEGER s }, com tamanho variável
 * e um zero à esquerda quando o número começaria com bit 1. O JOSE quer
 * exatamente `r || s`, 32 bytes cada, sem enfeite. É aqui que quase toda
 * implementação caseira de ES256 erra.
 */
export function derParaJose(der: Buffer): Buffer {
  if (der.length < 8 || der[0] !== 0x30) {
    throw new Error('Assinatura em formato inesperado.');
  }

  // Pula SEQUENCE e seu tamanho. Com mais de 127 bytes o tamanho é longo.
  let i = 2;
  if ((der[1] ?? 0) > 0x80) i = 2 + ((der[1] ?? 0) - 0x80);

  const lerInteiro = (): Buffer => {
    if (der[i] !== 0x02) throw new Error('Assinatura em formato inesperado.');
    const tamanho = der[i + 1] ?? 0;
    const inicio = i + 2;
    i = inicio + tamanho;
    let bytes = der.subarray(inicio, i);
    // Zero à esquerda que o DER acrescenta quando o byte mais alto tem bit 1.
    while (bytes.length > 32 && bytes[0] === 0x00) bytes = bytes.subarray(1);
    if (bytes.length > 32) throw new Error('Assinatura em formato inesperado.');
    // E o JOSE exige 32 bytes fixos, então o que falta vira zero à esquerda.
    return Buffer.concat([Buffer.alloc(32 - bytes.length), bytes]);
  };

  const r = lerInteiro();
  const s = lerInteiro();
  return Buffer.concat([r, s]);
}

/** Erro de chave inválida, separado para a interface saber o que dizer. */
export class ChaveInvalida extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ChaveInvalida';
  }
}

function lerChave(p8: string): KeyObject {
  try {
    return createPrivateKey({ key: p8, format: 'pem' });
  } catch {
    throw new ChaveInvalida('O arquivo enviado não é uma chave válida da Apple.');
  }
}

/**
 * Monta o token JWT que a App Store Connect aceita.
 *
 * `aud` é sempre `appstoreconnect-v1` e o algoritmo é sempre ES256 — os dois
 * são exigência da Apple, não escolha nossa.
 */
export function montarToken(chave: ChaveDaAppStore, agoraS: number): string {
  const cabecalho = base64url(JSON.stringify({ alg: 'ES256', kid: chave.keyId, typ: 'JWT' }));
  const corpo = base64url(
    JSON.stringify({
      iss: chave.issuerId,
      iat: agoraS,
      exp: agoraS + VALIDADE_DO_TOKEN_S,
      aud: 'appstoreconnect-v1',
    }),
  );

  const assinador = createSign('SHA256');
  assinador.update(`${cabecalho}.${corpo}`);
  assinador.end();

  const der = assinador.sign(lerChave(chave.p8));
  return `${cabecalho}.${corpo}.${base64url(derParaJose(der))}`;
}

export type ResultadoDaValidacao =
  | { ok: true; /** Quantos apps a conta já tem. Só para dar contexto na tela. */ apps: number }
  | { ok: false; motivo: string };

const TIMEOUT_MS = 20_000;

/**
 * Confere a chave chamando a própria API da Apple.
 *
 * `GET /v1/apps` é a chamada mais barata que exige autenticação de verdade:
 * ela falha com 401 se a chave, o Key ID ou o Issuer ID estiverem errados, e
 * com 403 se a chave existir mas não tiver papel suficiente — que é uma
 * situação diferente e precisa de uma instrução diferente.
 */
export async function validarChaveDaApple(
  chave: ChaveDaAppStore,
  buscador: typeof fetch = fetch,
  agoraS: number = Math.floor(Date.now() / 1000),
): Promise<ResultadoDaValidacao> {
  if (!pareceChaveP8(chave.p8)) {
    return {
      ok: false,
      motivo: 'O arquivo enviado não parece uma chave .p8. Baixe de novo no App Store Connect.',
    };
  }
  if (chave.keyId.trim() === '' || chave.issuerId.trim() === '') {
    return { ok: false, motivo: 'Informe o Key ID e o Issuer ID que aparecem junto da chave.' };
  }

  let token: string;
  try {
    token = montarToken(chave, agoraS);
  } catch (erro) {
    return {
      ok: false,
      motivo:
        erro instanceof ChaveInvalida
          ? erro.message
          : 'Não conseguimos usar essa chave. Baixe outra no App Store Connect.',
    };
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  try {
    const resposta = await buscador(`${BASE_DA_API}/v1/apps?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controle.signal,
    });
    return lerRespostaDaApple(resposta.status, await resposta.text());
  } catch {
    return {
      ok: false,
      motivo: 'Não conseguimos falar com a Apple agora. Tente de novo em instantes.',
    };
  } finally {
    clearTimeout(relogio);
  }
}

/** Traduz a resposta da Apple em algo que o lojista consegue agir. */
export function lerRespostaDaApple(status: number, texto: string): ResultadoDaValidacao {
  if (status === 401) {
    return {
      ok: false,
      motivo:
        'A Apple não aceitou essa chave. Confira se o Key ID e o Issuer ID são os mesmos que aparecem ao lado dela no App Store Connect.',
    };
  }
  if (status === 403) {
    /*
     * 403 é diferente de 401 e precisa de instrução diferente: a chave está
     * certa, mas foi criada com papel de menos. Dizer "chave inválida" aqui
     * faria o lojista gerar outra chave igual e falhar de novo.
     */
    return {
      ok: false,
      motivo:
        'Essa chave não tem permissão suficiente. Gere outra com o papel "Admin" ou "App Manager".',
    };
  }
  if (status < 200 || status >= 300) {
    return { ok: false, motivo: 'A Apple recusou a conexão. Tente de novo em instantes.' };
  }

  try {
    const lido: unknown = JSON.parse(texto);
    const dados =
      lido !== null && typeof lido === 'object' ? (lido as Record<string, unknown>).data : null;
    return { ok: true, apps: Array.isArray(dados) ? dados.length : 0 };
  } catch {
    // Respondeu 2xx: a chave vale. O corpo ilegível não muda isso.
    return { ok: true, apps: 0 };
  }
}

// ------------------------------------------- o identificador e o app (C12)

/** O que voltou de uma chamada à App Store Connect, ou o motivo de não ter voltado. */
type Chamada = { ok: true; status: number; corpo: unknown } | { ok: false; motivo: string };

async function chamarApple(
  chave: ChaveDaAppStore,
  caminho: string,
  init: { method?: 'GET' | 'POST'; corpo?: unknown },
  buscador: typeof fetch,
  agoraS: number,
): Promise<Chamada> {
  let token: string;
  try {
    token = montarToken(chave, agoraS);
  } catch {
    return {
      ok: false,
      motivo: 'Não conseguimos usar a chave da Apple guardada. Conecte a conta Apple de novo.',
    };
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  try {
    const resposta = await buscador(`${BASE_DA_API}${caminho}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: init.corpo === undefined ? undefined : JSON.stringify(init.corpo),
      signal: controle.signal,
    });
    const texto = await resposta.text();
    let corpo: unknown = null;
    try {
      corpo = texto === '' ? null : JSON.parse(texto);
    } catch {
      corpo = null;
    }
    return { ok: true, status: resposta.status, corpo };
  } catch {
    return {
      ok: false,
      motivo: 'Não conseguimos falar com a Apple agora. Tente de novo em instantes.',
    };
  } finally {
    clearTimeout(relogio);
  }
}

/** Os itens de `data` numa resposta da Apple, como registros soltos. */
function itensDe(corpo: unknown): Record<string, unknown>[] {
  const dados =
    corpo !== null && typeof corpo === 'object' ? (corpo as Record<string, unknown>).data : null;
  if (!Array.isArray(dados)) return [];
  return dados.filter(
    (item): item is Record<string, unknown> => item !== null && typeof item === 'object',
  );
}

function atributo(item: Record<string, unknown>, nome: string): string | null {
  const atributos = item.attributes;
  if (atributos === null || typeof atributos !== 'object') return null;
  const valor = (atributos as Record<string, unknown>)[nome];
  return typeof valor === 'string' ? valor : null;
}

/** 401 e 403 dizem coisas diferentes, e pedem instruções diferentes. */
function motivoDeAcesso(status: number, oQue: string): string | null {
  if (status === 401) {
    return 'A Apple não aceitou mais a chave guardada. Conecte a conta Apple de novo em Publicação › Contas.';
  }
  if (status === 403) {
    return `A chave da Apple não tem permissão para ${oQue}. Gere outra com o papel "Admin" e conecte de novo.`;
  }
  return null;
}

/**
 * O nome que a Apple aceita na descrição do identificador: letras sem acento,
 * números e espaços. Qualquer símbolo ("&", "'") derruba o registro inteiro.
 */
export function nomeParaAApple(nome: string): string {
  const limpo = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50)
    .trim();
  return limpo === '' ? 'Storefy app' : limpo;
}

export type ResultadoDoRegistro = { ok: true; jaExistia: boolean } | { ok: false; motivo: string };

/**
 * Registra o identificador na conta Apple do lojista (Certificates,
 * Identifiers & Profiles).
 *
 * É o que faz o identificador aparecer na lista "ID do pacote" quando o
 * lojista cria o app no App Store Connect — criar o app em si a API da Apple
 * não deixa, e esse passo é guiado na tela. Registrar duas vezes não dá erro:
 * se já existe nesta conta, está pronto.
 */
export async function registrarIdentificadorNaApple(
  chave: ChaveDaAppStore,
  identificador: string,
  nomeDoApp: string,
  buscador: typeof fetch = fetch,
  agoraS: number = Math.floor(Date.now() / 1000),
): Promise<ResultadoDoRegistro> {
  const busca = await chamarApple(
    chave,
    `/v1/bundleIds?filter[identifier]=${encodeURIComponent(identificador)}&limit=200`,
    {},
    buscador,
    agoraS,
  );
  if (!busca.ok) return busca;
  const negadaNaBusca = motivoDeAcesso(busca.status, 'registrar o identificador do app');
  if (negadaNaBusca !== null) return { ok: false, motivo: negadaNaBusca };
  if (busca.status >= 200 && busca.status < 300) {
    // O filtro da Apple também devolve os que COMEÇAM pelo texto: confere igual.
    const existe = itensDe(busca.corpo).some(
      (item) => atributo(item, 'identifier') === identificador,
    );
    if (existe) return { ok: true, jaExistia: true };
  }

  const criacao = await chamarApple(
    chave,
    '/v1/bundleIds',
    {
      method: 'POST',
      corpo: {
        data: {
          type: 'bundleIds',
          attributes: {
            identifier: identificador,
            name: nomeParaAApple(nomeDoApp),
            platform: 'IOS',
          },
        },
      },
    },
    buscador,
    agoraS,
  );
  if (!criacao.ok) return criacao;
  if (criacao.status === 201 || criacao.status === 200) return { ok: true, jaExistia: false };

  const negada = motivoDeAcesso(criacao.status, 'registrar o identificador do app');
  if (negada !== null) return { ok: false, motivo: negada };
  if (criacao.status === 409) {
    /*
     * 409 é a Apple dizendo que o identificador não está livre: outra conta
     * Apple já o registrou (o identificador é único no mundo inteiro, e não só
     * na conta de cada um). A saída é outro identificador.
     */
    return {
      ok: false,
      motivo:
        'Esse identificador já está registrado em outra conta Apple. Troque o identificador aqui na Publicação e tente de novo.',
    };
  }
  return {
    ok: false,
    motivo: 'A Apple não registrou o identificador agora. Tente de novo em instantes.',
  };
}

export type ResultadoDaBusca =
  { ok: true; app: { id: string; nome: string | null } | null } | { ok: false; motivo: string };

/**
 * Procura, na conta Apple do lojista, o app criado com este identificador.
 *
 * O número que volta (o "Apple ID" do app) é o que o envio à App Store e o
 * banner "baixe o app" usam. `null` quando o lojista ainda não criou o app.
 */
export async function procurarAppNaApple(
  chave: ChaveDaAppStore,
  identificador: string,
  buscador: typeof fetch = fetch,
  agoraS: number = Math.floor(Date.now() / 1000),
): Promise<ResultadoDaBusca> {
  const busca = await chamarApple(
    chave,
    `/v1/apps?filter[bundleId]=${encodeURIComponent(identificador)}&fields[apps]=bundleId,name&limit=200`,
    {},
    buscador,
    agoraS,
  );
  if (!busca.ok) return busca;
  const negada = motivoDeAcesso(busca.status, 'ver os apps da conta');
  if (negada !== null) return { ok: false, motivo: negada };
  if (busca.status < 200 || busca.status >= 300) {
    return {
      ok: false,
      motivo: 'A Apple não respondeu à busca agora. Tente de novo em instantes.',
    };
  }

  const achado = itensDe(busca.corpo).find(
    (item) => atributo(item, 'bundleId') === identificador && typeof item.id === 'string',
  );
  if (achado === undefined || typeof achado.id !== 'string' || !/^[0-9]{6,15}$/.test(achado.id)) {
    return { ok: true, app: null };
  }
  return { ok: true, app: { id: achado.id, nome: atributo(achado, 'name') } };
}

import 'server-only';

/**
 * Validação da conta de serviço do Google (assistente C13 do plano).
 *
 * O lojista baixa um JSON no Google Cloud e envia aqui. Com ele a Storefy
 * manda o AAB para a trilha interna do Play e acompanha a publicação.
 *
 * A validação é em dois passos, e os dois importam:
 *
 *   1. o arquivo é mesmo uma conta de serviço, com os campos que interessam?
 *      Um `client_secret.json` de OAuth é o arquivo errado mais comum, e ele
 *      se parece o bastante para confundir;
 *   2. a chave privada dele consegue trocar um JWT por um token de acesso no
 *      Google? É o que prova que a conta existe, está ativa e a chave não foi
 *      revogada — coisas que nenhuma checagem de formato descobre.
 *
 * A assinatura é RS256, que o Node faz direto: `createSign('RSA-SHA256')`
 * devolve exatamente o que o JOSE espera, sem a conversão que o ES256 da Apple
 * exige.
 */
import { createSign, createPrivateKey } from 'node:crypto';

export const URL_DO_TOKEN = 'https://oauth2.googleapis.com/token';

/**
 * O escopo do Google Play Developer API.
 *
 * Pedir só este, e não `cloud-platform`: uma conta de serviço com escopo
 * amplo, guardada por nós, é um risco desnecessário para o cliente — e é o
 * tipo de coisa que aparece numa auditoria de segurança dele.
 */
export const ESCOPO_DO_PLAY = 'https://www.googleapis.com/auth/androidpublisher';

export interface ContaDeServico {
  client_email: string;
  private_key: string;
  project_id?: string;
  type?: string;
}

export type LeituraDoArquivo = { ok: true; conta: ContaDeServico } | { ok: false; motivo: string };

/**
 * Lê o JSON que o lojista enviou.
 *
 * Cada recusa diz qual arquivo ele provavelmente pegou por engano. "JSON
 * inválido" mandaria ele conferir o arquivo certo mil vezes.
 */
export function lerContaDeServico(texto: string): LeituraDoArquivo {
  let lido: unknown;
  try {
    lido = JSON.parse(texto);
  } catch {
    return {
      ok: false,
      motivo: 'Esse arquivo não é um JSON válido. Baixe de novo a chave da conta de serviço.',
    };
  }

  if (lido === null || typeof lido !== 'object' || Array.isArray(lido)) {
    return { ok: false, motivo: 'Esse arquivo não parece a chave de uma conta de serviço.' };
  }

  const objeto = lido as Record<string, unknown>;

  if (objeto.type !== undefined && objeto.type !== 'service_account') {
    /*
     * O engano mais comum: o arquivo de credenciais OAuth (`client_secret`),
     * que também é JSON e também vem do Google Cloud. Dizer o nome dele
     * economiza uma ida ao suporte.
     */
    return {
      ok: false,
      motivo:
        'Esse é o arquivo de credenciais OAuth, não o da conta de serviço. Em "Contas de serviço", crie uma chave do tipo JSON.',
    };
  }

  const email = objeto.client_email;
  const chave = objeto.private_key;

  if (typeof email !== 'string' || !email.includes('@')) {
    return { ok: false, motivo: 'O arquivo está sem o e-mail da conta de serviço.' };
  }
  if (typeof chave !== 'string' || !chave.includes('PRIVATE KEY')) {
    return { ok: false, motivo: 'O arquivo está sem a chave privada.' };
  }

  return {
    ok: true,
    conta: {
      client_email: email,
      private_key: chave,
      project_id: typeof objeto.project_id === 'string' ? objeto.project_id : undefined,
      type: 'service_account',
    },
  };
}

export const VALIDADE_DO_TOKEN_S = 3600;

function base64url(dados: Buffer | string): string {
  return Buffer.from(dados).toString('base64url');
}

/** Monta o JWT que o Google troca por um token de acesso. */
export function montarAssercao(conta: ContaDeServico, escopo: string, agoraS: number): string {
  const cabecalho = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = base64url(
    JSON.stringify({
      iss: conta.client_email,
      scope: escopo,
      aud: URL_DO_TOKEN,
      iat: agoraS,
      exp: agoraS + VALIDADE_DO_TOKEN_S,
    }),
  );

  const assinador = createSign('RSA-SHA256');
  assinador.update(`${cabecalho}.${corpo}`);
  assinador.end();

  // A `private_key` do JSON vem com `\n` escapado quando alguém a copia e cola
  // pelo caminho errado. Desescapar aqui evita "chave inválida" numa chave boa.
  const pem = conta.private_key.includes('\\n')
    ? conta.private_key.replace(/\\n/g, '\n')
    : conta.private_key;

  const assinatura = assinador.sign(createPrivateKey({ key: pem, format: 'pem' }));
  return `${cabecalho}.${corpo}.${base64url(assinatura)}`;
}

export type ResultadoDaValidacao = { ok: true; email: string } | { ok: false; motivo: string };

const TIMEOUT_MS = 20_000;

/**
 * Confere a conta trocando o JWT por um token de acesso.
 *
 * É a chamada mais barata que prova tudo o que importa: que a conta existe,
 * que a chave não foi revogada e que o projeto está com a API ligada.
 */
export async function validarContaDoGoogle(
  textoDoArquivo: string,
  buscador: typeof fetch = fetch,
  agoraS: number = Math.floor(Date.now() / 1000),
): Promise<ResultadoDaValidacao> {
  const leitura = lerContaDeServico(textoDoArquivo);
  if (!leitura.ok) return { ok: false, motivo: leitura.motivo };

  let asercao: string;
  try {
    asercao = montarAssercao(leitura.conta, ESCOPO_DO_PLAY, agoraS);
  } catch {
    return {
      ok: false,
      motivo: 'A chave privada do arquivo não pôde ser usada. Gere outra chave JSON.',
    };
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  try {
    const resposta = await buscador(URL_DO_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: asercao,
      }).toString(),
      signal: controle.signal,
    });

    return lerRespostaDoGoogle(resposta.status, await resposta.text(), leitura.conta.client_email);
  } catch {
    return {
      ok: false,
      motivo: 'Não conseguimos falar com o Google agora. Tente de novo em instantes.',
    };
  } finally {
    clearTimeout(relogio);
  }
}

/** Traduz a resposta do Google em algo que o lojista consegue agir. */
export function lerRespostaDoGoogle(
  status: number,
  texto: string,
  email: string,
): ResultadoDaValidacao {
  let corpo: Record<string, unknown> = {};
  try {
    const lido: unknown = JSON.parse(texto);
    if (lido !== null && typeof lido === 'object') corpo = lido as Record<string, unknown>;
  } catch {
    /* Segue com o corpo vazio: o status ainda decide. */
  }

  if (status >= 200 && status < 300 && typeof corpo.access_token === 'string') {
    return { ok: true, email };
  }

  const erro = typeof corpo.error === 'string' ? corpo.error : '';
  const descricao = typeof corpo.error_description === 'string' ? corpo.error_description : '';
  const pista = `${erro} ${descricao}`.toLowerCase();

  if (pista.includes('invalid_grant') || pista.includes('invalid jwt')) {
    return {
      ok: false,
      motivo:
        'O Google não aceitou essa conta de serviço. Ela pode ter sido apagada ou a chave revogada — gere uma chave JSON nova.',
    };
  }
  if (pista.includes('disabled') || pista.includes('not been used') || pista.includes('api')) {
    return {
      ok: false,
      motivo:
        'A API do Google Play não está ligada nesse projeto. Ative "Google Play Android Developer API" e tente de novo.',
    };
  }
  if (status >= 500) {
    return { ok: false, motivo: 'O Google está indisponível agora. Tente de novo em instantes.' };
  }

  return { ok: false, motivo: 'O Google recusou essa conta de serviço.' };
}

import 'server-only';

/**
 * O envio do binário para a loja de aplicativos (passo 5 da seção 7 do plano).
 *
 * POR QUE ISTO É UM SEGUNDO WORKFLOW, e não o final do primeiro: o build sai
 * com `--no-wait`, então o workflow de geração termina minutos antes de o
 * binário existir. Quem sabe que ele ficou pronto é o webhook do EAS — e é de
 * lá que o envio começa.
 *
 * O `eas submit` precisa de um runner com o CLI do Expo e da credencial da
 * conta do lojista, então ele roda no GitHub Actions pelo mesmo caminho do
 * build: dispatch com identificadores, credenciais buscadas por rota
 * autenticada.
 */

export const TIPO_DO_EVENTO_DE_SUBMISSAO = 'storefy-submit';

const TIMEOUT_MS = 20_000;

export type ResultadoDoDisparo = { ok: true } | { ok: false; motivo: string };

/**
 * Pede ao GitHub que rode `submit-store-app.yml` para este build.
 *
 * Devolve o motivo em português quando não dá — ele vai parar na tela do
 * lojista, porque um binário pronto que não foi enviado é um problema DELE,
 * não um detalhe de infraestrutura nosso.
 */
export async function dispararSubmissao(
  buildId: string,
  buscador: typeof fetch = fetch,
): Promise<ResultadoDoDisparo> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repositorio = process.env.GITHUB_REPO;

  if (token == null || token === '') {
    return { ok: false, motivo: MOTIVO_SEM_CONFIGURACAO };
  }
  if (repositorio == null || !/^[\w.-]+\/[\w.-]+$/.test(repositorio)) {
    return { ok: false, motivo: MOTIVO_SEM_CONFIGURACAO };
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  try {
    const resposta = await buscador(`https://api.github.com/repos/${repositorio}/dispatches`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      // Só o identificador. A credencial da conta Apple do cliente é buscada
      // pelo runner numa rota autenticada, nunca por aqui.
      body: JSON.stringify({
        event_type: TIPO_DO_EVENTO_DE_SUBMISSAO,
        client_payload: { buildId },
      }),
      signal: controle.signal,
    });

    return resposta.status === 204 ? { ok: true } : { ok: false, motivo: MOTIVO_NAO_ENVIADO };
  } catch {
    return { ok: false, motivo: MOTIVO_NAO_ENVIADO };
  } finally {
    clearTimeout(relogio);
  }
}

export const MOTIVO_SEM_CONFIGURACAO =
  'O app foi gerado, mas a Storefy ainda não terminou de configurar o envio automático. Baixe o arquivo abaixo e envie pela loja, ou fale com o suporte.';

export const MOTIVO_NAO_ENVIADO =
  'O app foi gerado, mas não conseguimos enviá-lo para a loja automaticamente. Baixe o arquivo abaixo e envie você mesmo — ele está pronto.';

/** O passo manual que destrava um build, quando existe um. */
export type AcaoManual = 'play_primeiro_envio' | 'envio_manual';

export interface FalhaDoEnvio {
  mensagem: string;
  acaoManual: AcaoManual | null;
}

/**
 * Traduz a falha do `eas submit` para o lojista.
 *
 * O CASO QUE IMPORTA é o primeiro envio ao Google. O Play Console exige que o
 * primeiro `.aab` de um pacote seja subido à mão — nenhuma API publica um app
 * que ainda não existe lá. Não é um defeito nosso nem dele: é regra do Google,
 * e vale uma vez por app. A tela precisa saber disso para mostrar o passo a
 * passo em vez de um erro seco que parece bug.
 */
export function interpretarFalhaDoEnvio(
  plataforma: 'ios' | 'android',
  texto: string,
): FalhaDoEnvio {
  const t = texto.toLowerCase();

  if (
    plataforma === 'android' &&
    (t.includes('not found') ||
      t.includes('could not find') ||
      t.includes('edits.insert') ||
      t.includes('has never been uploaded') ||
      t.includes('only releases with status draft'))
  ) {
    return {
      mensagem:
        'O Google exige que o PRIMEIRO envio de um app seja feito à mão no Play Console. Faça este uma vez; os próximos saem daqui automaticamente.',
      acaoManual: 'play_primeiro_envio',
    };
  }

  if (t.includes('credential') || t.includes('service account') || t.includes('unauthorized')) {
    return {
      mensagem:
        'A loja não aceitou as credenciais da sua conta de desenvolvedor. Reconecte a conta e publique de novo.',
      acaoManual: null,
    };
  }

  if (t.includes('app-specific') || t.includes('app store connect app') || t.includes('no app')) {
    return {
      mensagem:
        'O app ainda não está cadastrado na App Store Connect. Crie o registro com o mesmo Bundle ID e publique de novo.',
      acaoManual: null,
    };
  }

  return {
    mensagem:
      texto.trim() === ''
        ? 'Não conseguimos enviar o app para a loja. Baixe o arquivo abaixo e envie você mesmo — ele está pronto.'
        : texto.trim().slice(0, 2000),
    acaoManual: 'envio_manual',
  };
}

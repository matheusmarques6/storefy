import 'server-only';

/**
 * O disparo da correção OTA.
 *
 * Separado de `lib/ota.ts` porque lê `process.env`: o formulário do admin é um
 * componente de cliente e importa de lá o limite da mensagem e a validação.
 * Juntos, o `server-only` do disparo derrubaria o build inteiro — e o erro
 * apontaria para o formulário, não para a importação que o causou.
 */
import { MAXIMO_DA_MENSAGEM } from '@/lib/ota';

export const TIPO_DO_EVENTO_DE_OTA = 'storefy-ota';

const TIMEOUT_MS = 20_000;

export type ResultadoDoDisparo = { ok: true } | { ok: false; motivo: string };

export const MOTIVO_SEM_CONFIGURACAO =
  'A Storefy ainda não terminou de configurar a geração de apps. Confira GITHUB_DISPATCH_TOKEN e GITHUB_REPO.';

export const MOTIVO_NAO_DISPAROU =
  'Não conseguimos pedir a correção agora. Tente de novo em instantes.';

/** Pede ao GitHub que rode `ota-update.yml` para esta rodada. */
export async function dispararOta(
  otaId: string,
  mensagem: string,
  buscador: typeof fetch = fetch,
): Promise<ResultadoDoDisparo> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repositorio = process.env.GITHUB_REPO;

  if (token == null || token === '') return { ok: false, motivo: MOTIVO_SEM_CONFIGURACAO };
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
      // Identificador e mensagem. Nenhuma credencial: o `client_payload` fica
      // visível para quem lê as execuções do repositório.
      body: JSON.stringify({
        event_type: TIPO_DO_EVENTO_DE_OTA,
        client_payload: { otaId, mensagem: mensagem.trim().slice(0, MAXIMO_DA_MENSAGEM) },
      }),
      signal: controle.signal,
    });

    return resposta.status === 204 ? { ok: true } : { ok: false, motivo: MOTIVO_NAO_DISPAROU };
  } catch {
    return { ok: false, motivo: MOTIVO_NAO_DISPAROU };
  } finally {
    clearTimeout(relogio);
  }
}

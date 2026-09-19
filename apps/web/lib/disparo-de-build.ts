import 'server-only';

/**
 * O disparo do build (passo 2 da seção 7 do plano).
 *
 * O painel não gera binário: ele cria a linha em `builds` e avisa o GitHub
 * Actions, que roda o workflow `build-store-app.yml`. O `repository_dispatch`
 * é o gatilho porque o build precisa de um runner com Node, Fastlane e as
 * ferramentas do EAS — coisas que não cabem numa função serverless de 60
 * segundos.
 *
 * O que uma pessoa precisa configurar para isto funcionar:
 *
 *   `GITHUB_DISPATCH_TOKEN` — um token com permissão de `contents: write` no
 *   repositório que hospeda o workflow;
 *   `GITHUB_REPO` — no formato `dono/repositorio`.
 *
 * Sem os dois, `dispararBuild` recusa com uma mensagem clara em vez de criar
 * uma linha em `builds` que ficaria em "na fila" para sempre.
 */

export const TIPO_DO_EVENTO = 'storefy-build';

export interface PedidoDeBuild {
  buildId: string;
  storeId: string;
  appId: string;
  platform: 'ios' | 'android';
  /** Versão da config que entra no binário. */
  configVersion: number;
}

export type ResultadoDoDisparo = { ok: true } | { ok: false; motivo: string };

/** O repositório está configurado? Devolve o motivo quando não. */
export function faltaConfiguracaoDoDisparo(
  token: string | undefined,
  repositorio: string | undefined,
): string | null {
  if (token == null || token === '') {
    return 'A Storefy ainda não terminou de configurar a geração de apps.';
  }
  if (repositorio == null || !/^[\w.-]+\/[\w.-]+$/.test(repositorio)) {
    return 'A Storefy ainda não terminou de configurar a geração de apps.';
  }
  return null;
}

const TIMEOUT_MS = 20_000;

export async function dispararBuild(
  pedido: PedidoDeBuild,
  buscador: typeof fetch = fetch,
): Promise<ResultadoDoDisparo> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repositorio = process.env.GITHUB_REPO;

  const falta = faltaConfiguracaoDoDisparo(token, repositorio);
  if (falta !== null) return { ok: false, motivo: falta };

  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  try {
    const resposta = await buscador(
      `https://api.github.com/repos/${repositorio ?? ''}/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token ?? ''}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        /*
         * `client_payload` só leva IDENTIFICADORES. Nenhuma credencial passa
         * por aqui: o workflow busca o que precisa por uma rota autenticada,
         * porque o payload de um dispatch fica visível para quem tem acesso
         * de leitura às execuções do repositório.
         */
        body: JSON.stringify({
          event_type: TIPO_DO_EVENTO,
          client_payload: {
            buildId: pedido.buildId,
            storeId: pedido.storeId,
            appId: pedido.appId,
            platform: pedido.platform,
            configVersion: pedido.configVersion,
          },
        }),
        signal: controle.signal,
      },
    );

    return lerRespostaDoDisparo(resposta.status);
  } catch {
    return {
      ok: false,
      motivo: 'Não conseguimos iniciar a geração agora. Tente de novo em instantes.',
    };
  } finally {
    clearTimeout(relogio);
  }
}

/** O GitHub responde 204 sem corpo quando aceita o dispatch. */
export function lerRespostaDoDisparo(status: number): ResultadoDoDisparo {
  if (status === 204) return { ok: true };

  if (status === 401 || status === 403) {
    return { ok: false, motivo: 'A Storefy precisa revisar a configuração da geração de apps.' };
  }
  if (status === 404) {
    /*
     * 404 aqui quase sempre é token sem permissão, e não repositório
     * inexistente: o GitHub esconde repositório privado de quem não pode vê-lo.
     * A mensagem é a mesma de 403 de propósito.
     */
    return { ok: false, motivo: 'A Storefy precisa revisar a configuração da geração de apps.' };
  }
  return { ok: false, motivo: 'Não conseguimos iniciar a geração agora. Tente de novo.' };
}

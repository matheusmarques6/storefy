/**
 * De onde a `AppConfig` vem (seção 5.3 do plano).
 *
 * A decisão de qual config usar está em `decisao.ts`, que é pura. Aqui fica só
 * o IO: ler o cache, gravar o cache e buscar na rede. A separação é o que
 * permite testar as escolhas caras — abrir com config velha, travar numa tela
 * de atualização — sem aparelho e sem rede.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export { urlDaConfig } from './decisao';

/** Chave do cache. Versionada: um formato novo não deve ler o antigo. */
export const CHAVE_DO_CACHE = 'storefy:app-config:v1';

/**
 * Tempo limite da busca na rede.
 *
 * Sem limite, um 3G ruim deixaria a promessa pendurada e a config nova nunca
 * chegaria nem falharia. O app não espera por isso para abrir — abre com o
 * cache —, mas a promessa precisa terminar de um jeito ou de outro.
 */
export const TEMPO_LIMITE_MS = 6000;

/** O que estava guardado no aparelho, ou `null`. */
export async function lerCache(): Promise<unknown> {
  try {
    const bruto = await AsyncStorage.getItem(CHAVE_DO_CACHE);
    if (bruto === null) return null;
    return JSON.parse(bruto);
  } catch {
    // Cache corrompido é caso real (atualização interrompida, disco cheio).
    // Quem chama trata `null` caindo para a config embutida.
    return null;
  }
}

/** Guarda a config para a próxima abertura. Falhar aqui não quebra nada. */
export async function gravarCache(config: unknown): Promise<boolean> {
  try {
    await AsyncStorage.setItem(CHAVE_DO_CACHE, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

/** Marca de que o cliente já passou pelo onboarding. */
export const CHAVE_DO_ONBOARDING = 'storefy:onboarding-visto:v1';

/** O cliente já viu o onboarding? Falha de leitura conta como "não viu". */
export async function leuOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CHAVE_DO_ONBOARDING)) !== null;
  } catch {
    // Mostrar os slides de novo incomoda; pular sem o cliente ter visto
    // esconde a explicação do app para sempre. Na dúvida, mostra.
    return false;
  }
}

/** Guarda que o onboarding foi visto. */
export async function marcarOnboardingVisto(): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAVE_DO_ONBOARDING, new Date().toISOString());
  } catch {
    // Sem disco, o onboarding volta na próxima abertura. Chato, não quebra.
  }
}

/** Busca a config publicada. Devolve `null` em qualquer falha. */
export async function buscarNaRede(url: string): Promise<unknown> {
  const cancelador = new AbortController();
  const alarme = setTimeout(() => {
    cancelador.abort();
  }, TEMPO_LIMITE_MS);

  try {
    const resposta = await fetch(url, {
      signal: cancelador.signal,
      headers: { Accept: 'application/json' },
    });
    if (!resposta.ok) return null;
    return await resposta.json();
  } catch {
    // Sem rede, DNS fora, JSON truncado: todos caem no cache ou na embutida.
    return null;
  } finally {
    clearTimeout(alarme);
  }
}

/** Guarda o último código usado, para o app de prévia reabrir no mesmo.  */
export const CHAVE_DA_PREVIA = 'storefy:previa:v1';

export async function lerTokenGuardado(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CHAVE_DA_PREVIA);
  } catch {
    return null;
  }
}

export async function guardarToken(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAVE_DA_PREVIA, token);
  } catch {
    // Sem disco, o lojista digita o código de novo na próxima abertura.
  }
}

export async function esquecerToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CHAVE_DA_PREVIA);
  } catch {
    // Sem código guardado é o mesmo resultado que apagar com sucesso.
  }
}

/**
 * Busca o rascunho de um código de prévia.
 *
 * Distingue "código morto" de "rede fora" porque as duas coisas pedem ações
 * diferentes do lojista: gerar outro código, ou tentar de novo.
 */
export type ResultadoDaPrevia =
  { estado: 'ok'; config: unknown } | { estado: 'expirado' } | { estado: 'falhou' };

export async function buscarPrevia(url: string): Promise<ResultadoDaPrevia> {
  const cancelador = new AbortController();
  const alarme = setTimeout(() => {
    cancelador.abort();
  }, TEMPO_LIMITE_MS);

  try {
    const resposta = await fetch(url, {
      signal: cancelador.signal,
      headers: { Accept: 'application/json' },
    });
    if (resposta.status === 404 || resposta.status === 400) return { estado: 'expirado' };
    if (!resposta.ok) return { estado: 'falhou' };
    return { estado: 'ok', config: await resposta.json() };
  } catch {
    return { estado: 'falhou' };
  } finally {
    clearTimeout(alarme);
  }
}

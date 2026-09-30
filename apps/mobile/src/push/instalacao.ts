/**
 * O identificador desta instalação do app (C05, C11 e C15).
 *
 * O aparelho só existia para a Storefy pela inscrição do push, e o push é
 * opcional: um app no ar sem push não contava instalação, ativo, sessão nem
 * MAU — o painel mostrava zero com a loja vendendo pelo app. Agora o app gera
 * este identificador na primeira abertura e o manda em toda abertura, com ou
 * sem push; a inscrição, quando existe, vai junto.
 *
 * É um UUID aleatório guardado no próprio aparelho. Não é o número do
 * celular nem o identificador de publicidade: desinstalar o app o apaga, e
 * reinstalar gera outro — exatamente o que a política de privacidade diz.
 *
 * Só a lógica, sem o disco e o gerador de verdade (`disco.ts` os liga): assim
 * ela roda no teste, fora do celular.
 */

export const CHAVE_DA_INSTALACAO = 'storefy:instalacao';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface DiscoDaInstalacao {
  getItem: (chave: string) => Promise<string | null>;
  setItem: (chave: string, valor: string) => Promise<void>;
}

/**
 * O identificador guardado, ou um novo, guardado agora.
 *
 * `null` quando não dá para ler ou guardar. NUNCA um identificador que não
 * foi guardado: ele mudaria a cada abertura, e cada abertura contaria como
 * uma instalação nova. Sem ele, o aparelho ainda conta pela inscrição do
 * push, quando houver.
 */
export async function lerOuCriarInstalacao(
  disco: DiscoDaInstalacao,
  gerar: () => string,
): Promise<string | null> {
  try {
    const guardada = await disco.getItem(CHAVE_DA_INSTALACAO);
    if (guardada !== null && UUID.test(guardada)) return guardada;
  } catch {
    // Disco que não lê hoje pode ler amanhã: gerar outro agora duplicaria o aparelho.
    return null;
  }

  let nova: string;
  try {
    nova = gerar().toLowerCase();
  } catch {
    return null;
  }
  if (!UUID.test(nova)) return null;

  try {
    await disco.setItem(CHAVE_DA_INSTALACAO, nova);
  } catch {
    return null;
  }
  return nova;
}

/**
 * Face ID ou digital na aba Conta (M06, checklist 5.7 do plano).
 *
 * O lojista liga em Recursos (`features.biometricLogin`), e o cliente passa a
 * desbloquear a aba Conta com o rosto ou a digital — com a senha do aparelho
 * como alternativa, que o próprio sistema oferece.
 *
 * NUNCA TRANCA QUEM NÃO TEM COMO ABRIR. Sem sensor, sem biometria cadastrada
 * ou num binário gerado antes do recurso existir (sem a permissão de Face ID
 * no Info.plist, a Apple recusa o pedido), a aba abre normalmente: proteger a
 * conta de alguém não pode virar trancar o cliente para fora dela.
 *
 * Tudo que decide é função pura, testada sem aparelho; o módulo nativo fica
 * no componente.
 */

/**
 * O plugin que põe a permissão de Face ID no binário. É o mesmo nome de
 * `PLUGIN_BIOMETRIA` (`config/plugins.ts`); o teste confere que não divergem.
 */
export const PLUGIN_DE_BIOMETRIA = 'expo-local-authentication';

/**
 * Depois de quanto tempo em segundo plano a conta volta a pedir desbloqueio.
 * Trocar de app para copiar um código não deve pedir o rosto de novo; deixar
 * o celular na mesa por meia hora, sim.
 */
export const TRANCAR_DEPOIS_DE_MS = 5 * 60 * 1000;

/** O binário foi gerado com a permissão de Face ID? (lista de plugins do build) */
export function binarioComBiometria(plugins: unknown): boolean {
  if (!Array.isArray(plugins)) return false;
  return plugins.some((plugin: unknown) =>
    Array.isArray(plugin) ? plugin[0] === PLUGIN_DE_BIOMETRIA : plugin === PLUGIN_DE_BIOMETRIA,
  );
}

export interface CondicoesDaBiometria {
  /** `features.biometricLogin` da config da loja. */
  recursoLigado: boolean;
  /** O binário tem a permissão (ver `binarioComBiometria`). */
  binarioPermite: boolean;
  /** O aparelho tem sensor. */
  temSensor: boolean;
  /** Há rosto ou digital cadastrado no aparelho. */
  temCadastro: boolean;
}

/** A aba Conta deve pedir desbloqueio? Só com TUDO a favor. */
export function deveProtegerConta(condicoes: CondicoesDaBiometria): boolean {
  return (
    condicoes.recursoLigado &&
    condicoes.binarioPermite &&
    condicoes.temSensor &&
    condicoes.temCadastro
  );
}

/**
 * Voltou do segundo plano: tranca de novo?
 *
 * `saiuEm` nulo é "nunca saiu" (ou já foi contado): nada a fazer.
 */
export function trancarAoVoltar(saiuEm: number | null, agora: number): boolean {
  return saiuEm !== null && agora - saiuEm >= TRANCAR_DEPOIS_DE_MS;
}

/** A resposta do sistema ao pedido (`expo-local-authentication`). */
export type RespostaDoSistema = { success: true } | { success: false; error: string };

/** O que a tela faz com a resposta. */
export type DepoisDoPedido = { acao: 'abrir' } | { acao: 'manter'; aviso: string | null };

/**
 * O aparelho deixou de ter como confirmar quem é, no meio da sessão: a pessoa
 * apagou o rosto, a digital ou a senha com o app em segundo plano. A regra do
 * começo do arquivo vale aqui também — a conta abre.
 */
const SEM_COMO_CONFIRMAR = new Set(['not_enrolled', 'passcode_not_set', 'not_available']);

/** A pessoa desistiu, ou o sistema interrompeu: sem bronca, o botão resolve. */
const DESISTIU = new Set(['user_cancel', 'system_cancel', 'app_cancel', 'user_fallback']);

export function depoisDoPedido(resposta: RespostaDoSistema): DepoisDoPedido {
  if (resposta.success) return { acao: 'abrir' };
  if (SEM_COMO_CONFIRMAR.has(resposta.error)) return { acao: 'abrir' };
  if (DESISTIU.has(resposta.error)) return { acao: 'manter', aviso: null };
  if (resposta.error === 'lockout') {
    return {
      acao: 'manter',
      aviso: 'Foram muitas tentativas. Desbloqueie o celular com a senha e tente de novo.',
    };
  }
  return { acao: 'manter', aviso: 'Não deu para confirmar que é você. Tente de novo.' };
}

/**
 * Páginas da conta que não mostram dado de ninguém: são portas de entrada.
 * Desviá-las tiraria o cliente do meio do checkout, onde "Entrar" leva ao
 * login e o login volta ao pagamento.
 */
const PORTAS_DA_CONTA = new Set(['login', 'register', 'recover', 'activate', 'reset', 'logout']);

/**
 * O caminho mostra dados da conta do cliente?
 *
 * Com a conta protegida, esses caminhos só abrem na aba Conta, que é onde a
 * trava está. Sem isto, o ícone de conta do cabeçalho do tema abriria os
 * pedidos e os endereços do cliente na aba Início, sem Face ID nenhum — e a
 * proteção seria de enfeite.
 *
 * `prefixo` é o caminho da aba Conta (`/account` na Shopify). O prefixo de
 * idioma dos mercados da Shopify (`/en/account`, `/pt-pt/account`) é o mesmo
 * lugar em outra língua, e o id da loja na frente (`/12345/account`) é a conta
 * nova da Shopify, em `shopify.com`.
 */
export function ehDadoDaConta(caminho: string, prefixo: string): boolean {
  const base = normalizarCaminho(prefixo);
  if (base === '/') return false;

  const alvo = normalizarCaminho(caminho.split(/[?#]/, 1)[0] ?? '');
  const semIdioma = alvo.replace(/^\/[a-z]{2}(?:-[a-z0-9]{2,4})?(?=\/)/, '');
  const semIdDaLoja = alvo.replace(/^\/\d+(?=\/)/, '');

  return [alvo, semIdioma, semIdDaLoja].some((candidato) => {
    if (candidato === base) return true;
    if (!candidato.startsWith(`${base}/`)) return false;
    const trecho = candidato.slice(base.length + 1).split('/', 1)[0] ?? '';
    return !PORTAS_DA_CONTA.has(trecho);
  });
}

/** `/Account/` e `account` viram `/account`; a raiz continua `/`. */
function normalizarCaminho(caminho: string): string {
  const texto = caminho.trim().toLowerCase();
  const comBarra = texto.startsWith('/') ? texto : `/${texto}`;
  const semFinal = comBarra.replace(/\/+$/, '');
  return semFinal === '' ? '/' : semFinal;
}

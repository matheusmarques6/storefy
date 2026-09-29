/**
 * M12 — o que a tela de ajustes diz das notificações, e o que a chave faz.
 *
 * A Apple exige que o cliente possa DESLIGAR, dentro do app, as notificações
 * de promoção (diretriz 4.5.4) — e o Storefy é justamente campanha de
 * promoção. Mandar para os ajustes do celular não basta: lá só se desliga
 * tudo, e o pedido é por um caminho no próprio app.
 *
 * Três camadas, e a tela precisa distinguir todas:
 *   - a permissão do SISTEMA (dada ou recusada no alerta do iOS/Android);
 *   - a inscrição no OneSignal, que o app liga e desliga (`optIn`/`optOut`)
 *     sem mexer na permissão;
 *   - se ESTE app manda notificação (o build tem OneSignal).
 *
 * Funções puras sobre a interface do `onesignal.ts`: o teste prova a tela sem
 * aparelho.
 */
import type { Notificador } from './onesignal.ts';
import type { PermissaoDoSistema } from './permissao.ts';

export type EstadoDasNotificacoes =
  /** Este app não manda notificação: a seção nem aparece. */
  | 'indisponivel'
  /** Ainda lendo a permissão e a inscrição. */
  | 'carregando'
  | 'ligadas'
  /** Desligadas no app, ou nunca ligadas: a chave liga. */
  | 'desligadas'
  /** Recusadas no sistema: só pelos ajustes do celular. */
  | 'bloqueadas';

export interface EntradaDoEstado {
  /** O build tem OneSignal? */
  disponivel: boolean;
  /** A permissão do sistema já foi lida? */
  sistemaLido: boolean;
  sistema: PermissaoDoSistema;
  /** `getOptedInAsync`; `null` enquanto não foi lido. */
  inscrito: boolean | null;
}

export function estadoDasNotificacoes(entrada: EntradaDoEstado): EstadoDasNotificacoes {
  if (!entrada.disponivel) return 'indisponivel';
  // Recusado no sistema não depende da inscrição: nada chega de jeito nenhum.
  if (entrada.sistemaLido && entrada.sistema === 'negada') return 'bloqueadas';
  if (!entrada.sistemaLido || entrada.inscrito === null) return 'carregando';
  return entrada.sistema === 'concedida' && entrada.inscrito ? 'ligadas' : 'desligadas';
}

/**
 * Liga: pede a permissão se ainda não foi dada e volta a inscrever.
 *
 * Quem recusa no alerta do sistema pode cair em "bloqueadas" (o iOS não
 * pergunta duas vezes) ou continuar em "desligadas" (o Android às vezes deixa
 * perguntar de novo) — quem sabe é o próprio SDK, pelo `podePedir`.
 */
export async function ligarNotificacoes(
  notificador: Pick<Notificador, 'ligar' | 'podePedir'>,
  sistema: PermissaoDoSistema,
  pedirPermissao: () => Promise<boolean>,
): Promise<Exclude<EstadoDasNotificacoes, 'indisponivel' | 'carregando'>> {
  if (sistema === 'negada') return 'bloqueadas';
  if (sistema !== 'concedida') {
    const aceitou = await pedirPermissao();
    if (!aceitou) return (await notificador.podePedir()) ? 'desligadas' : 'bloqueadas';
  }
  // Quem desligou antes continua fora até o `optIn`, mesmo com a permissão.
  notificador.ligar();
  return 'ligadas';
}

/** Desliga só a inscrição: a permissão do sistema continua como está. */
export function desligarNotificacoes(notificador: Pick<Notificador, 'desligar'>): 'desligadas' {
  notificador.desligar();
  return 'desligadas';
}

/** "Versão 1.2.0 (12)": o que o suporte da loja pergunta primeiro. */
export function textoDaVersao(versao: string, build: number): string {
  return `Versão ${versao} (${String(build)})`;
}

/**
 * O endereço da política de privacidade do app, pelo id dele.
 *
 * `null` sem credencial: o app de prévia e um build sem API não têm loja
 * para a qual apontar — e um link que abre uma página de erro é pior do que
 * nenhum.
 */
export function urlDaPolitica(
  credenciais: { apiBase: string; appId: string } | null,
): string | null {
  if (credenciais === null) return null;
  return `${credenciais.apiBase.replace(/\/+$/, '')}/privacy/app/${encodeURIComponent(credenciais.appId)}`;
}

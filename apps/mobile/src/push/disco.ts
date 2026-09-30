/**
 * O que o push guarda no aparelho.
 *
 * Quatro coisas, e todas LOCAIS de propósito: quantas vezes já perguntamos
 * sobre notificação, quais avisos o cliente já abriu, quantas vezes ele abriu
 * o app e a última notificação que ele tocou. Nada disso sobe para o servidor
 * — é informação sobre uma pessoa que não serve a ninguém fora do aparelho
 * dela. (O toque só sai do aparelho dentro do carrinho, como o atributo que
 * liga a compra à notificação, e sem nada que identifique a pessoa.)
 *
 * Nenhuma função daqui lança. O disco pode estar cheio, o app pode ter sido
 * restaurado de um backup com formato antigo, e nada disso pode impedir a loja
 * de abrir.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { lerAtributoDoPush, valorDoAtributoDoPush, type ToqueNoPush } from '@storefy/config-schema';
import { lerOuCriarInstalacao } from './instalacao.ts';
import { HISTORICO_VAZIO, lerHistorico, type HistoricoDoPrePrompt } from './permissao.ts';
import { lerLidos } from './caixa.ts';

const CHAVE_DO_PRE_PROMPT = 'storefy:push:pre-prompt';
const CHAVE_DOS_LIDOS = 'storefy:push:avisos-lidos';
const CHAVE_DAS_ABERTURAS = 'storefy:push:aberturas';
const CHAVE_DO_TOQUE = 'storefy:push:ultimo-toque';

export async function lerHistoricoDoDisco(): Promise<HistoricoDoPrePrompt> {
  try {
    return lerHistorico(await AsyncStorage.getItem(CHAVE_DO_PRE_PROMPT));
  } catch {
    return HISTORICO_VAZIO;
  }
}

export async function gravarHistorico(historico: HistoricoDoPrePrompt): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAVE_DO_PRE_PROMPT, JSON.stringify(historico));
  } catch {
    /* Sem o registro, no máximo perguntamos de novo antes da hora. */
  }
}

export async function lerLidosDoDisco(): Promise<string[]> {
  try {
    return lerLidos(await AsyncStorage.getItem(CHAVE_DOS_LIDOS));
  } catch {
    return [];
  }
}

export async function gravarLidos(ids: readonly string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAVE_DOS_LIDOS, JSON.stringify(ids));
  } catch {
    /* No máximo um badge que não zera até a próxima leitura dar certo. */
  }
}

/**
 * Conta esta abertura e devolve o total.
 *
 * É o que sustenta "não pergunte na primeira vez que ele abrir o app". Conta
 * aberturas, e não sessões: um app que volta do segundo plano não é uma visita
 * nova, e contar assim faria a pergunta aparecer no primeiro dia.
 */
export async function contarAbertura(): Promise<number> {
  try {
    const bruto = await AsyncStorage.getItem(CHAVE_DAS_ABERTURAS);
    const anterior = Number.parseInt(bruto ?? '0', 10);
    const total = (Number.isInteger(anterior) && anterior > 0 ? anterior : 0) + 1;
    await AsyncStorage.setItem(CHAVE_DAS_ABERTURAS, String(total));
    return total;
  } catch {
    // Sem disco, toda abertura parece a primeira — e a primeira não pergunta.
    // Errar para o lado de não incomodar é o lado certo de errar aqui.
    return 1;
  }
}

/**
 * O último toque numa notificação, guardado para a compra que vier depois.
 *
 * No disco porque a compra raramente é na hora: o cliente toca, olha, fecha o
 * app e volta à noite — e a venda ainda é daquela notificação. O formato é o
 * mesmo do atributo do carrinho, lido pela mesma função do webhook.
 */
export async function lerToqueDoDisco(): Promise<ToqueNoPush | null> {
  try {
    return lerAtributoDoPush(await AsyncStorage.getItem(CHAVE_DO_TOQUE));
  } catch {
    // Sem disco, a compra só não leva o crédito da notificação: nada quebra.
    return null;
  }
}

export async function gravarToque(toque: ToqueNoPush): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAVE_DO_TOQUE, valorDoAtributoDoPush(toque));
  } catch {
    /* O toque vale nesta sessão do mesmo jeito; só não sobrevive a fechar o app. */
  }
}

let instalacao: Promise<string | null> | null = null;

/**
 * O identificador desta instalação (`instalacao.ts`), lido UMA vez por
 * abertura do app.
 *
 * Na primeira abertura, a contagem da abertura e a chegada da inscrição do
 * push pedem o identificador quase juntas. Sem a promessa guardada, as duas
 * achariam o disco vazio e gerariam DOIS — e o mesmo aparelho contaria como
 * duas instalações.
 */
export function idDaInstalacao(): Promise<string | null> {
  instalacao ??= lerOuCriarInstalacao(AsyncStorage, randomUUID);
  return instalacao;
}

/**
 * O que o push guarda no aparelho.
 *
 * Três coisas, e todas LOCAIS de propósito: quantas vezes já perguntamos sobre
 * notificação, quais avisos o cliente já abriu e quantas vezes ele abriu o
 * app. Nada disso sobe para o servidor — é informação sobre uma pessoa que não
 * serve a ninguém fora do aparelho dela.
 *
 * Nenhuma função daqui lança. O disco pode estar cheio, o app pode ter sido
 * restaurado de um backup com formato antigo, e nada disso pode impedir a loja
 * de abrir.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HISTORICO_VAZIO, lerHistorico, type HistoricoDoPrePrompt } from './permissao.ts';
import { lerLidos } from './caixa.ts';

const CHAVE_DO_PRE_PROMPT = 'storefy:push:pre-prompt';
const CHAVE_DOS_LIDOS = 'storefy:push:avisos-lidos';
const CHAVE_DAS_ABERTURAS = 'storefy:push:aberturas';

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

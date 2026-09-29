import 'server-only';

/**
 * A07 — revalidar a credencial Apple ou Google de um cliente.
 *
 * A credencial foi validada quando o lojista a enviou; depois disso, ninguém
 * sabe se ela continua valendo até o próximo build falhar — semanas depois, e
 * o cliente acha que o produto quebrou. A equipe revalida daqui, com a MESMA
 * conferência do envio: a chamada mais barata que prova que a chave ainda
 * abre a conta.
 *
 * O QUE A LOJA NÃO RESPONDEU NÃO VIRA ERRO. Rede caída ou a Apple fora do ar
 * (5xx) não dizem nada sobre a chave; marcar a conta "com erro" por isso
 * faria o cliente refazer uma credencial que está boa. Só a recusa da própria
 * Apple ou Google (ou um arquivo que nem abre) muda o estado.
 *
 * O segredo é aberto aqui, no servidor, e não sai daqui.
 */
import { validarChaveDaApple } from '@/lib/apple';
import { validarContaDoGoogle } from '@/lib/google';
import { descriptografar } from '@/lib/cripto';

export interface CredencialGuardada {
  platform: 'apple' | 'google';
  asc_key_id: string | null;
  asc_issuer_id: string | null;
  asc_key_enc: string | null;
  google_service_account_enc: string | null;
}

export type Revalidacao =
  /** A loja aceitou: a conta volta (ou continua) verificada. */
  | { resultado: 'valida'; observacao: string | null }
  /** A loja recusou, ou o que está guardado não serve: a conta fica com erro. */
  | { resultado: 'invalida'; motivo: string }
  /** A loja não respondeu: nada muda, e a equipe tenta depois. */
  | { resultado: 'indisponivel'; motivo: string }
  /** Não há credencial guardada para conferir. */
  | { resultado: 'sem_credencial' };

export interface Dependencias {
  buscador?: typeof fetch;
  abrir?: (pacote: string) => string;
  agoraS?: number;
}

export async function revalidarCredencial(
  conta: CredencialGuardada,
  dependencias: Dependencias = {},
): Promise<Revalidacao> {
  const abrir = dependencias.abrir ?? descriptografar;
  const buscador = dependencias.buscador ?? fetch;

  /*
   * O buscador vigiado anota se a rede caiu ou se a loja respondeu 5xx: é o
   * que separa "a chave não vale" de "a Apple não atendeu agora".
   */
  const vigia = { semResposta: false };
  const vigiado: typeof fetch = async (...argumentos) => {
    try {
      const resposta = await buscador(...argumentos);
      if (resposta.status >= 500) vigia.semResposta = true;
      return resposta;
    } catch (erro) {
      vigia.semResposta = true;
      throw erro;
    }
  };

  const guardado =
    conta.platform === 'apple' ? conta.asc_key_enc : conta.google_service_account_enc;
  if (guardado == null || guardado === '') return { resultado: 'sem_credencial' };

  let aberto: string;
  try {
    aberto = abrir(guardado);
  } catch {
    return {
      resultado: 'invalida',
      motivo:
        'A credencial guardada não abre mais (a chave de criptografia do servidor mudou). O cliente precisa conectar a conta de novo.',
    };
  }

  const validacao =
    conta.platform === 'apple'
      ? await validarChaveDaApple(
          { p8: aberto, keyId: conta.asc_key_id ?? '', issuerId: conta.asc_issuer_id ?? '' },
          vigiado,
          dependencias.agoraS,
        )
      : await validarContaDoGoogle(aberto, vigiado, dependencias.agoraS);

  if (validacao.ok) {
    // Do Google, o e-mail da conta de serviço fica visível (não é segredo).
    return {
      resultado: 'valida',
      observacao: conta.platform === 'google' ? emailDaContaDeServico(aberto) : null,
    };
  }
  if (vigia.semResposta) {
    return {
      resultado: 'indisponivel',
      motivo: `${conta.platform === 'apple' ? 'A Apple' : 'O Google'} não respondeu agora. Nada mudou na conta; tente de novo em alguns minutos.`,
    };
  }
  return { resultado: 'invalida', motivo: validacao.motivo };
}

function emailDaContaDeServico(texto: string): string | null {
  try {
    const lido: unknown = JSON.parse(texto);
    const email = (lido as { client_email?: unknown } | null)?.client_email;
    return typeof email === 'string' ? email : null;
  } catch {
    return null;
  }
}

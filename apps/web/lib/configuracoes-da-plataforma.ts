/**
 * As chaves de funcionamento da plataforma (A13), com o padrão de cada uma.
 *
 * O banco guarda só o que foi MUDADO (`platform_settings`): chave ausente vale
 * o padrão daqui. É o que deixa uma plataforma recém-instalada funcionar sem
 * seed nenhum — e o que faz uma linha apagada por engano voltar ao padrão, e
 * não a um estado indefinido.
 *
 * A leitura é tolerante de propósito: um valor de tipo errado vira o padrão.
 * Estas chaves são lidas em toda tela do painel e no cadastro; um JSON ruim
 * aqui não pode derrubar o painel de todos os lojistas.
 */
import type { Json } from '@storefy/db';

export interface ConfiguracoesDaPlataforma {
  /** O cadastro por e-mail aceita contas novas. */
  cadastroAberto: boolean;
  /** Frase no topo do painel de todos os lojistas. Vazio, nada aparece. */
  avisoNoPainel: string;
}

export const PADRAO: ConfiguracoesDaPlataforma = { cadastroAberto: true, avisoNoPainel: '' };

/** O aviso tem de caber numa faixa: é uma frase, não um comunicado. */
export const TAMANHO_MAXIMO_DO_AVISO = 280;

export function lerConfiguracoes(
  linhas: readonly { chave: string; valor: Json }[],
): ConfiguracoesDaPlataforma {
  const valorDe = (chave: string): Json | undefined =>
    linhas.find((linha) => linha.chave === chave)?.valor;

  const cadastro = valorDe('cadastro_aberto');
  const aviso = valorDe('aviso_no_painel');

  return {
    cadastroAberto: typeof cadastro === 'boolean' ? cadastro : PADRAO.cadastroAberto,
    avisoNoPainel:
      typeof aviso === 'string'
        ? aviso.trim().slice(0, TAMANHO_MAXIMO_DO_AVISO)
        : PADRAO.avisoNoPainel,
  };
}

/** O aviso digitado no admin, conferido. */
export function conferirAviso(
  bruto: string,
): { ok: true; aviso: string } | { ok: false; mensagem: string } {
  const aviso = bruto.trim().replace(/\s+/g, ' ');
  if (aviso.length > TAMANHO_MAXIMO_DO_AVISO) {
    return {
      ok: false,
      mensagem: `O aviso passa de ${String(TAMANHO_MAXIMO_DO_AVISO)} caracteres. Ele aparece numa faixa: resuma em uma frase.`,
    };
  }
  return { ok: true, aviso };
}

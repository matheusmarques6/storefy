/**
 * O que aconteceu com os envios de uma automação que NÃO saíram (C10).
 *
 * É o que responde "por que meu cliente não recebeu?": ele comprou antes, já
 * tinha recebido um lembrete no dia, voltou ao app sozinho. O banco guarda o
 * motivo como o escreveu (`automation_runs.canceled_reason`), e a falha do
 * envio às vezes vem da OneSignal, em inglês — aqui tudo vira uma frase para
 * o lojista, sem jargão. Nada do cliente aparece: só contagens.
 */

export interface Desfecho {
  situacao: 'scheduled' | 'canceled' | 'failed';
  motivo: string | null;
  quantos: number;
}

export interface LinhaDoDesfecho {
  texto: string;
  quantos: number;
  /** `atencao` pede alguma ação do lojista; `neutro` é a automação funcionando. */
  tom: 'neutro' | 'atencao';
}

/** Os cancelamentos que a própria automação faz, e o que cada um quer dizer. */
const CANCELAMENTOS: Record<string, string> = {
  'compra concluída': 'Não saíram porque o cliente comprou antes',
  'carrinho esvaziado': 'Não saíram porque o cliente esvaziou o carrinho',
  'já recebeu um push de carrinho hoje':
    'Não saíram porque o cliente já tinha recebido um lembrete de carrinho no dia',
  'voltou a abrir o app': 'Não saíram porque o cliente voltou ao app antes',
  // Desligar cancela a fila (migration 69): ligar de novo não manda o que era de semanas atrás.
  'automação desligada': 'Não saíram porque a automação foi desligada',
};

/** As falhas de configuração que o despachante escreve (`lib/jobs.ts` e o despacho). */
const FALTA_CONFIGURAR = [
  'Esta loja ainda não tem as notificações configuradas.',
  'Falta a chave de envio desta loja.',
  'Não conseguimos ler a chave de envio desta loja.',
];

/** A OneSignal recusa assim o aparelho que desativou as notificações ou desinstalou o app. */
const APARELHO_SEM_INSCRICAO =
  /not subscribed|invalid_player_ids|invalid_aliases|nenhum aparelho recebeu/i;

function textoDoDesfecho(desfecho: Desfecho, ligada: boolean): Omit<LinhaDoDesfecho, 'quantos'> {
  if (desfecho.situacao === 'scheduled') {
    return ligada
      ? { texto: 'Esperando a hora de sair', tom: 'neutro' }
      : { texto: 'Paradas: a automação está desligada', tom: 'atencao' };
  }

  if (desfecho.situacao === 'canceled') {
    const texto = desfecho.motivo === null ? undefined : CANCELAMENTOS[desfecho.motivo];
    return { texto: texto ?? 'Canceladas antes de sair', tom: 'neutro' };
  }

  const motivo = desfecho.motivo ?? '';
  if (FALTA_CONFIGURAR.includes(motivo)) {
    return {
      texto: 'Não saíram porque as notificações da loja não estavam configuradas',
      tom: 'atencao',
    };
  }
  if (APARELHO_SEM_INSCRICAO.test(motivo)) {
    return {
      texto: 'Não saíram porque o aparelho não recebe mais notificações',
      tom: 'neutro',
    };
  }
  return { texto: 'Não saíram por uma falha no servidor de notificações', tom: 'atencao' };
}

/**
 * As linhas da tela, das mais comuns para as menos. Motivos diferentes que
 * dizem a mesma coisa ao lojista (duas falhas da OneSignal, por exemplo)
 * viram uma linha só, com a soma.
 */
export function descreverDesfechos(
  desfechos: readonly Desfecho[],
  ligada: boolean,
): LinhaDoDesfecho[] {
  const porTexto = new Map<string, LinhaDoDesfecho>();
  for (const desfecho of desfechos) {
    if (desfecho.quantos <= 0) continue;
    const { texto, tom } = textoDoDesfecho(desfecho, ligada);
    const atual = porTexto.get(texto);
    porTexto.set(texto, { texto, tom, quantos: (atual?.quantos ?? 0) + desfecho.quantos });
  }
  return [...porTexto.values()].sort((a, b) => b.quantos - a.quantos);
}

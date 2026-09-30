/**
 * A06 — o que fazer com cada app na revisão.
 *
 * A tela listava o estado e os dias; faltava o que o plano pede junto do
 * motivo: a AÇÃO SUGERIDA. É ela que deixa quem está de plantão resolver sem
 * precisar conhecer de cor o App Store Connect e o Play Console.
 *
 * E ela corrige uma mentira da tela: o build do Android vai para a trilha
 * interna do Play, que NÃO passa por revisão. Ele fica `submitted` até o
 * lojista promover a versão para produção no Play Console — e a tela dizia
 * "parado há 12 dias, vale abrir um chamado na loja", mandando a equipe
 * cobrar a Google por uma revisão que nunca começou.
 */
import type { Database } from '@storefy/db';
import { DIAS_ATE_ESTRANHAR, diasEsperando } from '@/lib/builds-admin';
import { mensagemDaRevisao } from '@/lib/revisao';

type BuildStatus = Database['public']['Enums']['build_status'];

export interface BuildNaRevisao {
  platform: 'ios' | 'android';
  status: BuildStatus;
  /** A mensagem da recusa, como o job de revisão gravou. */
  error: string | null;
  submitted_at: string | null;
  /**
   * O que a loja diz da versão (migration 66). É o que separa "a Apple está
   * revisando" de "ninguém mandou para a revisão ainda".
   */
  store_state: string | null;
}

/** Na Apple, a versão parada esperando o LOJISTA mandar para a revisão. */
const APPLE_SEM_ENVIO = new Set(['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW']);

export interface ProximoPasso {
  /** O passo, curto: vira o título da célula. */
  titulo: string;
  detalhe: string;
  /** Quem precisa agir: a equipe, o lojista ou ninguém (esperar a loja). */
  quem: 'equipe' | 'lojista' | 'esperar';
  /** Passou do normal? A tela destaca. */
  urgente: boolean;
}

/** A situação do build na linguagem da equipe, para a coluna de situação. */
export function situacaoNaRevisao(build: BuildNaRevisao): string | null {
  const estado = build.store_state ?? '';
  if (build.status === 'approved' && estado === 'PENDING_DEVELOPER_RELEASE') {
    return 'Aprovado, sem liberar';
  }
  if (build.status !== 'submitted') return null;

  if (build.platform === 'android') {
    if (estado === 'PLAY_PRODUCTION_DRAFT') return 'Rascunho na produção';
    if (estado === 'PLAY_HALTED') return 'Lançamento interrompido';
    return 'Na trilha interna';
  }
  if (estado === '' || APPLE_SEM_ENVIO.has(estado)) return 'Não enviado para a revisão';
  if (estado === 'NO_APP_STORE_VERSION') return 'Sem a versão na Apple';
  if (estado === 'WAITING_FOR_REVIEW') return 'Na fila da Apple';
  if (estado === 'WAITING_FOR_EXPORT_COMPLIANCE') return 'Falta a criptografia';
  if (estado === 'PENDING_CONTRACT') return 'Contratos pendentes';
  return null;
}

/** As recusas da Apple que têm conserto conhecido, pela mensagem gravada. */
const RECUSA = {
  ficha: mensagemDaRevisao('rejected', 'METADATA_REJECTED'),
  arquivo: mensagemDaRevisao('rejected', 'INVALID_BINARY'),
  retirada: mensagemDaRevisao('rejected', 'DEVELOPER_REJECTED'),
} as const;

export function proximoPassoDaRevisao(
  build: BuildNaRevisao,
  agora: number = Date.now(),
): ProximoPasso {
  const dias = diasEsperando(build.submitted_at, agora);

  if (build.status === 'rejected') {
    if (build.platform === 'android') {
      return {
        titulo: 'Ler o motivo no Play Console',
        detalhe:
          'A Google recusou a versão. O motivo está no Play Console, em Visão geral da publicação; corrija com o lojista e gere um build novo.',
        quem: 'equipe',
        urgente: true,
      };
    }
    if (build.error === RECUSA.ficha) {
      return {
        titulo: 'Corrigir a ficha do app',
        detalhe:
          'A Apple recusou as informações da ficha. Confira com o lojista os textos, as capturas e a política de privacidade (Publicação) e reenvie pelo App Store Connect.',
        quem: 'equipe',
        urgente: true,
      };
    }
    if (build.error === RECUSA.arquivo) {
      return {
        titulo: 'Gerar um build novo',
        detalhe:
          'A Apple recusou o arquivo. Gere de novo pela Publicação do lojista; se repetir, confira o log do build na fila (Builds).',
        quem: 'equipe',
        urgente: true,
      };
    }
    if (build.error === RECUSA.retirada) {
      return {
        titulo: 'Confirmar com o lojista',
        detalhe:
          'Alguém da equipe do lojista retirou a versão da revisão no App Store Connect. Pergunte o motivo antes de reenviar.',
        quem: 'lojista',
        urgente: false,
      };
    }
    return {
      titulo: 'Ler o motivo e corrigir',
      detalhe:
        'O motivo está no App Store Connect, em Resolution Center. Os mais comuns em app de loja: 4.2 (funcionalidade mínima) — ligar push, busca e abas nativas; 2.1 — mandar uma conta de teste nas notas de revisão; 5.1.1 — a exclusão de conta e a política de privacidade.',
      quem: 'equipe',
      urgente: true,
    };
  }

  const daVez = passoDoLojista(build);
  if (daVez !== null) return daVez;

  const loja = build.platform === 'ios' ? 'a Apple' : 'a Google';
  if (dias != null && dias >= DIAS_ATE_ESTRANHAR) {
    return {
      titulo: `Cobrar ${loja}`,
      detalhe:
        build.platform === 'ios'
          ? `Parado há ${String(dias)} dias. Peça ao lojista para abrir um contato com a App Review no App Store Connect (Contate-nos › App Review).`
          : `Parado há ${String(dias)} dias. Peça ao lojista para abrir um chamado no suporte do Play Console.`,
      quem: 'lojista',
      urgente: true,
    };
  }

  return {
    titulo: `Esperar ${loja}`,
    detalhe:
      build.platform === 'ios'
        ? 'A revisão da Apple costuma levar de 1 a 2 dias. Nada a fazer por enquanto.'
        : 'A revisão da Google costuma levar de algumas horas a 2 dias. Nada a fazer por enquanto.',
    quem: 'esperar',
    urgente: false,
  };
}

/**
 * Quando a vez é do LOJISTA, o passo é dele — e a equipe só precisa saber
 * qual, para lembrar se demorar. Sem isto, a tela dizia "Esperar a Apple" de
 * um binário que ninguém tinha mandado para a revisão.
 *
 * Nenhum desses é urgente: a primeira publicação espera capturas, textos e
 * questionários, e isso leva o tempo do lojista, não da loja.
 */
function passoDoLojista(build: BuildNaRevisao): ProximoPasso | null {
  const estado = build.store_state ?? '';

  if (build.status === 'approved') {
    return estado === 'PENDING_DEVELOPER_RELEASE'
      ? {
          titulo: 'Lojista liberar a versão',
          detalhe:
            'A Apple aprovou e está esperando o clique em "Liberar esta versão" na App Store Connect. O passo a passo está na Publicação do lojista.',
          quem: 'lojista',
          urgente: false,
        }
      : null;
  }
  if (build.status !== 'submitted') return null;

  if (build.platform === 'android') {
    if (estado === 'PLAY_PRODUCTION_DRAFT') {
      return {
        titulo: 'Lojista enviar a versão de produção',
        detalhe:
          'A versão de produção foi criada no Play Console e não foi enviada. O lojista abre o rascunho em Produção, salva e envia as mudanças para a revisão.',
        quem: 'lojista',
        urgente: false,
      };
    }
    if (estado === 'PLAY_HALTED') {
      return {
        titulo: 'Retomar o lançamento',
        detalhe:
          'O lançamento em produção foi interrompido no Play Console. Confirme com o lojista o motivo antes de retomar (Produção › Retomar lançamento).',
        quem: 'lojista',
        urgente: false,
      };
    }
    if (estado === 'PLAY_REPLACED') return null;
    return {
      titulo: 'Promover para produção',
      detalhe:
        'Está na trilha interna do Play, que não passa por revisão. O lojista promove a versão para produção no Play Console (Produção › Criar versão › Adicionar da biblioteca); a partir daí, a Google revisa lá.',
      quem: 'lojista',
      urgente: false,
    };
  }

  if (estado === '' || APPLE_SEM_ENVIO.has(estado)) {
    return {
      titulo: 'Lojista enviar para a revisão',
      detalhe:
        'O binário está na App Store Connect, mas ninguém o mandou para a revisão. O lojista escolhe o build, completa a ficha e o questionário de privacidade e clica em "Enviar para a revisão do app" — o passo a passo está na Publicação dele.',
      quem: 'lojista',
      urgente: false,
    };
  }
  if (estado === 'NO_APP_STORE_VERSION') {
    return {
      titulo: 'Lojista criar a versão na Apple',
      detalhe:
        'A App Store Connect não tem uma versão com o número deste build. O lojista cria a versão (ou troca o número da que está em "Preparar para envio"), escolhe o build e envia para a revisão.',
      quem: 'lojista',
      urgente: false,
    };
  }
  if (estado === 'WAITING_FOR_EXPORT_COMPLIANCE') {
    return {
      titulo: 'Lojista responder a criptografia',
      detalhe:
        'A Apple parou a versão em "Conformidade de exportação". O lojista responde que o app só usa a criptografia do sistema (HTTPS). Os builds novos já declaram isso sozinhos.',
      quem: 'lojista',
      urgente: false,
    };
  }
  if (estado === 'PENDING_CONTRACT') {
    return {
      titulo: 'Lojista aceitar os contratos',
      detalhe:
        'A Apple espera o titular da conta aceitar os contratos em "Negócios" na App Store Connect. Sem isso, nada anda.',
      quem: 'lojista',
      urgente: false,
    };
  }
  return null;
}

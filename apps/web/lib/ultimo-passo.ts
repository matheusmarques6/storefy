/**
 * C12 — o último passo para o app ir ao ar, e de quem é a vez.
 *
 * Gerar e enviar o app é com a Storefy. O último passo, não:
 *
 *   - na Apple, o binário chega à App Store Connect, e quem o manda para a
 *     revisão é o dono da conta — a primeira versão precisa das capturas, do
 *     questionário de privacidade e do clique em "Enviar para a revisão", e
 *     nenhuma API faz isso por ele;
 *   - no Google, a versão chega ao teste interno, que ninguém revisa e nenhum
 *     cliente vê. Para ir aos clientes, o lojista a publica em produção no
 *     Play Console — depois de preencher, uma única vez, o que a Google pede.
 *
 * A tela dizia "A loja recebeu. Agora é aguardar a revisão." — e ninguém
 * estava revisando. Aqui cada build vira o que o lojista precisa ler, a partir
 * do estado que a loja diz dele (`builds.store_state`, gravado pelo job da
 * revisão de hora em hora).
 */
import type { Database } from '@storefy/db';

type StatusDoBuild = Database['public']['Enums']['build_status'];

export interface BuildNaLoja {
  platform: 'ios' | 'android';
  status: StatusDoBuild;
  /** O que a loja de aplicativos diz desta versão; nulo antes da 1ª consulta. */
  storeState: string | null;
  version: string | null;
  buildNumber: number | null;
}

/** De quem é a vez: do lojista (há um passo dele), da loja (esperar) ou de ninguém. */
export type Vez = 'lojista' | 'loja' | 'ninguem';

export interface PassoDoLojista {
  titulo: string;
  passos: readonly string[];
  link: { rotulo: string; url: string };
}

export interface SituacaoNaLoja {
  /** A frase da linha do histórico. */
  explicacao: string;
  vez: Vez;
  /** O que fazer, quando é a vez do lojista. */
  passo: PassoDoLojista | null;
}

export interface ContextoDaLoja {
  /** O número do app na App Store Connect, para o link ir direto a ele. */
  iosAscAppId: string | null;
}

/** Os estados da Apple em que a versão está parada esperando o envio à revisão. */
const APPLE_FALTA_ENVIAR = new Set(['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW']);
const APPLE_NA_FILA = new Set(['WAITING_FOR_REVIEW']);
const APPLE_PROCESSANDO = new Set(['PROCESSING_FOR_APP_STORE', 'PROCESSING_FOR_DISTRIBUTION']);
const APPLE_NA_LOJA = new Set(['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION']);
const APPLE_SUBSTITUIDA = new Set(['REPLACED_WITH_NEW_VERSION', 'REPLACED_WITH_NEW_BUILD']);

function linkDaAppStoreConnect(contexto: ContextoDaLoja): PassoDoLojista['link'] {
  return {
    rotulo: 'Abrir na App Store Connect',
    url:
      contexto.iosAscAppId === null
        ? 'https://appstoreconnect.apple.com/apps'
        : `https://appstoreconnect.apple.com/apps/${encodeURIComponent(contexto.iosAscAppId)}/distribution`,
  };
}

const LINK_DO_PLAY_CONSOLE: PassoDoLojista['link'] = {
  rotulo: 'Abrir o Play Console',
  url: 'https://play.google.com/console',
};

function versaoDoBuild(build: BuildNaLoja): string {
  if (build.version !== null && build.buildNumber !== null) {
    return `${build.version} (${String(build.buildNumber)})`;
  }
  if (build.buildNumber !== null) return String(build.buildNumber);
  return build.version ?? 'mais recente';
}

/** O que a linha de um build diz, e o que o lojista faz — só para builds que chegaram à loja. */
export function situacaoNaLoja(
  build: BuildNaLoja,
  contexto: ContextoDaLoja,
): SituacaoNaLoja | null {
  if (build.status === 'rejected') {
    return { explicacao: 'A loja recusou. Veja o motivo e corrija.', vez: 'lojista', passo: null };
  }
  if (build.status !== 'submitted' && build.status !== 'in_review' && build.status !== 'approved') {
    return null;
  }
  return build.platform === 'ios' ? naApple(build, contexto) : naPlay(build);
}

function naApple(build: BuildNaLoja, contexto: ContextoDaLoja): SituacaoNaLoja {
  const estado = build.storeState ?? '';
  const link = linkDaAppStoreConnect(contexto);

  if (build.status === 'approved') {
    if (estado === 'PENDING_DEVELOPER_RELEASE') {
      return {
        explicacao: 'Aprovado pela Apple. Falta você liberar a versão.',
        vez: 'lojista',
        passo: {
          titulo: 'A Apple aprovou: falta você liberar',
          passos: [
            'Abra o app na App Store Connect (botão abaixo) e entre na versão aprovada.',
            'Clique em "Liberar esta versão". Em algumas horas o app aparece na App Store.',
          ],
          link,
        },
      };
    }
    if (estado === 'PENDING_APPLE_RELEASE') {
      return {
        explicacao: 'Aprovado. A Apple libera na data que você escolheu.',
        vez: 'loja',
        passo: null,
      };
    }
    return { explicacao: 'Aprovado. O app já está na App Store.', vez: 'ninguem', passo: null };
  }

  if (build.status === 'in_review' || estado === 'IN_REVIEW') {
    return { explicacao: 'Alguém da Apple está analisando o app.', vez: 'loja', passo: null };
  }
  if (APPLE_NA_FILA.has(estado)) {
    return {
      explicacao:
        'Enviado para a revisão. Está na fila da Apple, que costuma começar em até 2 dias.',
      vez: 'loja',
      passo: null,
    };
  }
  if (APPLE_PROCESSANDO.has(estado) || APPLE_NA_LOJA.has(estado)) {
    return {
      explicacao: 'A Apple está preparando esta versão para a loja.',
      vez: 'loja',
      passo: null,
    };
  }
  if (APPLE_SUBSTITUIDA.has(estado)) {
    return { explicacao: 'Substituída por uma versão mais nova.', vez: 'ninguem', passo: null };
  }
  if (estado === 'WAITING_FOR_EXPORT_COMPLIANCE') {
    return {
      explicacao: 'A Apple quer saber se o app usa criptografia. Responda na App Store Connect.',
      vez: 'lojista',
      passo: {
        titulo: 'Falta responder a pergunta da criptografia',
        passos: [
          'Abra o app na App Store Connect (botão abaixo).',
          `Na versão ${versaoDoBuild(build)}, abra "Conformidade de exportação".`,
          'Responda que o app só usa a criptografia do próprio sistema (a conexão segura HTTPS) e salve.',
        ],
        link,
      },
    };
  }
  if (estado === 'PENDING_CONTRACT') {
    return {
      explicacao: 'A Apple está esperando você aceitar os contratos da conta.',
      vez: 'lojista',
      passo: {
        titulo: 'Falta aceitar os contratos da Apple',
        passos: [
          'Entre na App Store Connect com o titular da conta.',
          'Em "Negócios" (Contratos), aceite os contratos pendentes.',
          'Volte aqui: a revisão segue sozinha depois disso.',
        ],
        link: {
          rotulo: 'Abrir a App Store Connect',
          url: 'https://appstoreconnect.apple.com/business',
        },
      },
    };
  }

  if (estado === 'NO_APP_STORE_VERSION') {
    const numero = build.version ?? versaoDoBuild(build);
    return {
      explicacao: `Chegou à App Store Connect, que ainda não tem a versão ${numero}. Falta você criá-la.`,
      vez: 'lojista',
      passo: {
        titulo: `Falta a versão ${numero} na App Store Connect`,
        passos: [
          'Abra o app na App Store Connect (botão abaixo).',
          `Se houver uma versão em "Preparar para envio", troque o número dela para ${numero}. Se não houver, crie uma com o "+" ao lado de "App para iOS", com o número ${numero}.`,
          `Em "Build", escolha a versão ${versaoDoBuild(build)}, que a Storefy enviou.`,
          'Complete o que faltar na ficha — numa atualização, basta o texto de "O que há de novo".',
          'Clique em "Adicionar para revisão" e depois em "Enviar para a revisão do app".',
        ],
        link,
      },
    };
  }

  // Sem estado ainda, ou "Preparar para envio": o binário chegou e ninguém o mandou para a revisão.
  if (estado === '' || APPLE_FALTA_ENVIAR.has(estado)) {
    return {
      explicacao: 'Chegou à App Store Connect. Falta você enviar para a revisão da Apple.',
      vez: 'lojista',
      passo: {
        titulo: 'Falta você enviar para a revisão da Apple',
        passos: [
          'Abra o app na App Store Connect (botão abaixo) e entre na versão em "Preparar para envio".',
          `Em "Build", escolha a versão ${versaoDoBuild(build)}, que a Storefy enviou.`,
          'Complete a ficha: as capturas, os textos (estão logo acima, em "Ficha do app") e o endereço da política de privacidade.',
          'Em "Privacidade do app", responda o questionário com o que a política de privacidade do app lista.',
          'Clique em "Adicionar para revisão" e depois em "Enviar para a revisão do app".',
        ],
        link,
      },
    };
  }

  // Um estado que não conhecemos: nada inventado, só o que se sabe.
  return {
    explicacao: 'Chegou à App Store Connect. Acompanhe o andamento por lá.',
    vez: 'loja',
    passo: null,
  };
}

function naPlay(build: BuildNaLoja): SituacaoNaLoja {
  const estado = build.storeState ?? '';

  if (build.status === 'approved' || estado === 'PLAY_LIVE') {
    return {
      explicacao: 'Em produção na Play Store, aberto para os clientes baixarem.',
      vez: 'ninguem',
      passo: null,
    };
  }
  if (build.status === 'in_review' || estado === 'PLAY_PRODUCTION') {
    return {
      explicacao:
        'Enviado para a produção. A Google revisa e publica — costuma levar de algumas horas a alguns dias.',
      vez: 'loja',
      passo: null,
    };
  }
  if (estado === 'PLAY_REPLACED') {
    return { explicacao: 'Substituída por uma versão mais nova.', vez: 'ninguem', passo: null };
  }
  if (estado === 'PLAY_PRODUCTION_DRAFT') {
    return {
      explicacao: 'A versão de produção foi criada no Play Console, mas não foi enviada.',
      vez: 'lojista',
      passo: {
        titulo: 'Falta enviar a versão de produção',
        passos: [
          'Abra o app no Play Console (botão abaixo).',
          'Em "Produção", abra a versão em rascunho, clique em "Avançar" e depois em "Salvar".',
          'Em "Visão geral da publicação", envie as mudanças para a revisão.',
        ],
        link: LINK_DO_PLAY_CONSOLE,
      },
    };
  }
  if (estado === 'PLAY_HALTED') {
    return {
      explicacao: 'O lançamento em produção foi interrompido no Play Console.',
      vez: 'lojista',
      passo: {
        titulo: 'O lançamento foi interrompido',
        passos: [
          'Abra o app no Play Console (botão abaixo).',
          'Em "Produção", abra a versão e clique em "Retomar lançamento" — ou publique uma versão nova por aqui, se ele foi interrompido por um problema.',
        ],
        link: LINK_DO_PLAY_CONSOLE,
      },
    };
  }

  // No teste interno (ou antes da primeira consulta): falta publicar em produção.
  return {
    explicacao: 'Está no teste interno da Play Store. Falta você publicar em produção.',
    vez: 'lojista',
    passo: {
      titulo: 'Falta você publicar em produção no Google Play',
      passos: [
        'Abra o app no Play Console (botão abaixo).',
        'No Painel, termine as tarefas de "Configurar o app": acesso ao app, anúncios, classificação do conteúdo, público-alvo e segurança dos dados, respondida com o que a política de privacidade do app lista. É só na primeira vez.',
        'Em "Página principal da loja", use os textos da ficha (logo acima) e envie o ícone, o recurso gráfico (1024 × 500) e as capturas.',
        `Em "Produção", clique em "Criar nova versão", depois em "Adicionar da biblioteca" e escolha a versão ${versaoDoBuild(build)}.`,
        'Clique em "Avançar" e em "Salvar", e envie as mudanças para a revisão em "Visão geral da publicação".',
      ],
      link: LINK_DO_PLAY_CONSOLE,
    },
  };
}

/**
 * O último passo pendente em cada loja: o da versão mais NOVA que chegou lá.
 *
 * Só a mais nova conta — uma versão antiga parada em "Preparar para envio"
 * não é o que o lojista tem de resolver quando uma mais nova já passou dela.
 */
export function passosPendentes(
  builds: readonly (BuildNaLoja & { createdAt: string })[],
  contexto: ContextoDaLoja,
): { plataforma: 'ios' | 'android'; passo: PassoDoLojista }[] {
  const pendentes: { plataforma: 'ios' | 'android'; passo: PassoDoLojista }[] = [];
  for (const plataforma of ['ios', 'android'] as const) {
    const maisNova = [...builds]
      .filter(
        (build) =>
          build.platform === plataforma &&
          (build.status === 'submitted' ||
            build.status === 'in_review' ||
            build.status === 'approved' ||
            build.status === 'rejected'),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (maisNova === undefined) continue;
    const situacao = situacaoNaLoja(maisNova, contexto);
    if (situacao?.passo != null) pendentes.push({ plataforma, passo: situacao.passo });
  }
  return pendentes;
}

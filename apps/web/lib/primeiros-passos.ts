/**
 * Os primeiros passos de uma loja, do cadastro ao app no ar (C04 e C05).
 *
 * A seção 10 do plano pede um checklist de progresso no painel até o app estar
 * no ar, e o C04 fecha o começo de cada loja com o mesmo checklist. É função
 * pura em cima do MESMO estado da tela de publicação (`dadosDaPublicacao`):
 * três telas contando o progresso com três leituras diferentes acabariam
 * discordando, e o lojista não saberia em qual acreditar.
 */
import type { Database } from '@storefy/db';

type StatusDoBuild = Database['public']['Enums']['build_status'];

export interface EntradaDosPrimeirosPassos {
  iconePronto: boolean;
  splashPronta: boolean;
  versaoPublicada: number | null;
  shopifyConectada: boolean;
  appleConectada: boolean;
  googleConectada: boolean;
  /** O status de cada build da loja, em qualquer ordem. */
  statusDosBuilds: readonly StatusDoBuild[];
}

export type ChaveDoPasso =
  'loja' | 'imagens' | 'publicado' | 'shopify' | 'contas' | 'enviado' | 'no-ar';

export interface PassoInicial {
  chave: ChaveDoPasso;
  titulo: string;
  /** Por que o passo importa, na língua de quem vende. */
  porque: string;
  feito: boolean;
  /** Para onde a tela manda quando o passo falta. */
  caminho: string;
  acao: string;
}

/**
 * A entrada a partir do que a tela de publicação leu (`dadosDaPublicacao`).
 * Estrutural de propósito: este arquivo não depende do módulo do servidor.
 */
export function entradaDaPublicacao(dados: {
  estado: {
    iconePronto: boolean;
    splashPronta: boolean;
    versaoPublicada: number | null;
    appleConectada: boolean;
    googleConectada: boolean;
  };
  links: { shopifyConectada: boolean };
  builds: readonly { status: StatusDoBuild }[];
}): EntradaDosPrimeirosPassos {
  return {
    iconePronto: dados.estado.iconePronto,
    splashPronta: dados.estado.splashPronta,
    versaoPublicada: dados.estado.versaoPublicada,
    shopifyConectada: dados.links.shopifyConectada,
    appleConectada: dados.estado.appleConectada,
    googleConectada: dados.estado.googleConectada,
    statusDosBuilds: dados.builds.map((build) => build.status),
  };
}

/** Os status de um build que já saiu do painel e foi para a Apple ou o Google. */
const JA_ENVIADO: ReadonlySet<StatusDoBuild> = new Set(['submitted', 'in_review', 'approved']);

export function primeirosPassos(entrada: EntradaDosPrimeirosPassos): PassoInicial[] {
  const enviado = entrada.statusDosBuilds.some((status) => JA_ENVIADO.has(status));
  const aprovado = entrada.statusDosBuilds.includes('approved');

  return [
    {
      chave: 'loja',
      titulo: 'Loja cadastrada',
      porque: 'O app já abre a sua loja, com carrinho, busca e conta.',
      feito: true,
      caminho: '/lojas',
      acao: 'Ver a loja',
    },
    {
      chave: 'imagens',
      titulo: 'Ícone e tela de abertura',
      porque: 'São a primeira coisa que o cliente vê, e as lojas de aplicativos exigem os dois.',
      feito: entrada.iconePronto && entrada.splashPronta,
      caminho: '/app',
      acao: 'Enviar no editor',
    },
    {
      chave: 'publicado',
      titulo: 'App publicado no painel',
      porque: 'O app dos seus clientes usa a versão publicada, e não o rascunho.',
      feito: entrada.versaoPublicada !== null,
      caminho: '/app',
      acao: 'Publicar no editor',
    },
    {
      chave: 'shopify',
      titulo: 'Shopify conectada',
      porque: 'É o que separa a venda que veio do app da que veio do site.',
      feito: entrada.shopifyConectada,
      caminho: '/integracoes',
      acao: 'Conectar',
    },
    {
      chave: 'contas',
      titulo: 'Contas da Apple e do Google conectadas',
      porque: 'O app sai nas contas da sua empresa, e não na da Storefy.',
      feito: entrada.appleConectada && entrada.googleConectada,
      caminho: '/publicacao/contas',
      acao: 'Conectar as contas',
    },
    {
      chave: 'enviado',
      titulo: 'App enviado às lojas',
      porque: 'A Apple e o Google revisam o app antes de ele aparecer para os clientes.',
      feito: enviado,
      caminho: '/publicacao',
      acao: 'Publicar nas lojas',
    },
    {
      chave: 'no-ar',
      titulo: 'App aprovado e no ar',
      porque: 'Daqui em diante, os clientes baixam o app e você fala com eles por notificação.',
      feito: aprovado,
      caminho: '/publicacao',
      acao: 'Acompanhar a revisão',
    },
  ];
}

/** Quantos passos já foram, e se acabou — o painel deixa de mostrar o checklist aí. */
export function progressoDosPassos(passos: readonly PassoInicial[]): {
  feitos: number;
  total: number;
  concluido: boolean;
} {
  const feitos = passos.filter((passo) => passo.feito).length;
  return { feitos, total: passos.length, concluido: feitos === passos.length };
}

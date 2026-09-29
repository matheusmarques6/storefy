/**
 * C17 — os artigos da central de ajuda.
 *
 * Conteúdo do produto, e não dado de exemplo: cada artigo descreve uma tela
 * que existe, com o nome que ela tem. `ajuda.test.ts` confere que todo atalho
 * leva a uma página de verdade — um artigo que manda a pessoa a uma tela que
 * mudou de lugar é pior do que nenhum.
 *
 * Mora no código, versionado, e não no banco: muda junto com as telas, no
 * mesmo commit, e passa pela mesma revisão.
 */

import type { Route } from 'next';

export interface SecaoDoArtigo {
  titulo: string;
  paragrafos: string[];
  /** Passo a passo, quando a seção é um "como fazer". */
  passos?: string[];
}

export interface Artigo {
  slug: string;
  titulo: string;
  resumo: string;
  /** Atalhos para as telas de que o artigo fala. */
  /** Tipado como rota do Next: um atalho para tela inexistente não compila. */
  atalhos: { rotulo: string; href: Route }[];
  secoes: SecaoDoArtigo[];
}

export const ARTIGOS: readonly Artigo[] = [
  {
    slug: 'primeiros-passos',
    titulo: 'Primeiros passos: da loja ao app no seu celular',
    resumo:
      'Cadastre a loja, monte o app no editor e veja o resultado no celular antes de publicar.',
    atalhos: [
      { rotulo: 'Cadastrar uma loja', href: '/lojas/nova' },
      { rotulo: 'Abrir o editor do app', href: '/app' },
    ],
    secoes: [
      {
        titulo: 'Cadastre a loja',
        paragrafos: [
          'Em Lojas › Nova loja, cole o endereço do site e toque em "Ler loja": a Storefy busca o nome, o logo e a cor principal da página inicial. Você confere e cria a loja.',
          'Cada loja tem o próprio app. Se a sua empresa tem mais de uma loja, cadastre cada uma e troque entre elas pelo seletor no topo do painel.',
        ],
      },
      {
        titulo: 'Monte o app no editor',
        paragrafos: [
          'O editor (menu App) tem cinco partes. Aparência: cores, ícone e tela de abertura. Abas: o que aparece na barra de baixo do app, e em que ordem. Loja: o que esconder do site dentro do app. Recursos: telas de boas-vindas, o banner "baixe o app" no site, quando pedir permissão de notificação e a atualização obrigatória. Versões: o que já foi publicado, e como voltar atrás.',
          'Tudo o que você muda aparece na prévia ao lado, na hora.',
        ],
      },
      {
        titulo: 'Veja no seu celular',
        paragrafos: [
          'Em "Ver no seu celular", gere o código e aponte a câmera do celular com o app Storefy Preview aberto. Você vê o rascunho exatamente como vai ficar, sem publicar nada.',
        ],
      },
      {
        titulo: 'Salve e publique',
        paragrafos: [
          '"Salvar rascunho" guarda o que você fez sem mudar o app dos clientes. "Publicar" coloca no ar: o app de quem já instalou atualiza em até um minuto, sem passar de novo pela Apple nem pelo Google.',
          'Mudou de ideia? Em Versões dá para carregar uma versão anterior no rascunho e publicar de novo.',
        ],
      },
    ],
  },
  {
    slug: 'publicar-nas-lojas',
    titulo: 'Publicar o app na App Store e no Google Play',
    resumo: 'O que você precisa ter, como conectar as contas e o que acontece na revisão.',
    atalhos: [{ rotulo: 'Abrir Publicação', href: '/publicacao' }],
    secoes: [
      {
        titulo: 'O app sai na SUA conta de desenvolvedor',
        paragrafos: [
          'A Apple exige que cada empresa publique o próprio app, na própria conta. Por isso você precisa de uma conta Apple Developer (paga anualmente à Apple) e de uma conta de desenvolvedor no Google Play (taxa única, paga ao Google). A Storefy prepara, gera e envia o app — mas em nome da sua empresa.',
        ],
      },
      {
        titulo: 'Conecte as contas',
        paragrafos: [
          'Em Publicação, o assistente de cada loja de aplicativos mostra onde pegar cada chave. Da Apple: a chave da API da App Store Connect e a chave de notificações (as duas em arquivo .p8). Do Google: a conta de serviço (arquivo .json). As chaves são conferidas na hora, antes de gravar, e ficam guardadas criptografadas.',
        ],
      },
      {
        titulo: 'Gere e envie',
        paragrafos: [
          'A lista de verificação da tela Publicação diz o que ainda falta. Com tudo pronto, "Publicar" gera o app (leva de 15 a 30 minutos) e envia para a revisão da loja. O andamento aparece na própria tela.',
        ],
      },
      {
        titulo: 'A revisão',
        paragrafos: [
          'A Apple e o Google revisam todo app novo e toda versão nova. Costuma levar de um a alguns dias. Quando sair o resultado, avisamos por e-mail os proprietários e administradores (dá para desligar em Configurações › Empresa).',
          'Se o app for recusado, o motivo aparece em Publicação. Corrija o que foi pedido e envie de novo.',
        ],
      },
    ],
  },
  {
    slug: 'conectar-shopify',
    titulo: 'Conectar a sua loja Shopify',
    resumo: 'Por que conectar, como autorizar e o que passa a funcionar.',
    atalhos: [{ rotulo: 'Abrir Integrações', href: '/integracoes' }],
    secoes: [
      {
        titulo: 'O que a conexão faz',
        paragrafos: [
          'Com a Shopify conectada, o painel separa o que o app vendeu do que o site vendeu (em Analytics) e mostra quanto cada notificação vendeu, as automações de carrinho abandonado, pedido enviado e de volta ao estoque passam a funcionar, e o composer de notificações busca produtos e coleções da loja para o link.',
        ],
      },
      {
        titulo: 'Como conectar',
        paragrafos: [],
        passos: [
          'Abra Integrações e escolha a loja no seletor do topo.',
          'Clique em "Conectar com a Shopify".',
          'No admin da Shopify, confira as permissões e autorize.',
          'Você volta ao painel com a loja conectada.',
        ],
      },
      {
        titulo: 'Desconectar',
        paragrafos: [
          'Em Integrações, "Desconectar" para de receber pedidos e apaga o acesso guardado. Os números que já foram contados continuam no Analytics.',
        ],
      },
    ],
  },
  {
    slug: 'notificacoes',
    titulo: 'Notificações: campanhas e automações',
    resumo:
      'Como mandar uma campanha, agendar no horário da loja, ligar as automações e ver quanto cada uma vendeu.',
    atalhos: [
      { rotulo: 'Nova campanha', href: '/push/nova' },
      { rotulo: 'Automações', href: '/push/automacoes' },
    ],
    secoes: [
      {
        titulo: 'Campanhas',
        paragrafos: [
          'Em Notificações › Nova campanha, escreva o título e a mensagem e, se quiser, a página que o toque abre: um produto ou uma coleção da loja (em "Escolher produto ou coleção") ou qualquer página do site. Vazio, o toque abre o app na tela inicial. A prévia mostra como fica no iPhone e no Android.',
          'Enviar agora pede confirmação e diz para quantos aparelhos vai. Agendar usa o horário da loja — o fuso fica na página da loja, em Lojas. Antes de mandar para todo mundo, use o envio de teste no seu celular.',
          'Uma campanha salva como rascunho não sai para ninguém até você enviar ou agendar.',
        ],
      },
      {
        titulo: 'Automações',
        paragrafos: [
          'Boas-vindas: para quem instala o app e aceita notificações. Carrinho abandonado: para quem deixou produto no carrinho — cancelada sozinha se a compra acontecer antes, e no máximo uma por dia para a mesma pessoa. De volta ao estoque: para quem pediu para ser avisado de um produto. Pedido enviado: quando você marca o pedido como enviado na Shopify.',
          'Para não acordar ninguém, as automações não disparam entre 22h e 8h no horário da loja: ficam para as 8h. As campanhas saem na hora que você escolher.',
        ],
      },
      {
        titulo: 'Quanto cada notificação vendeu',
        paragrafos: [
          'Quando o cliente toca numa notificação, o app guarda de qual campanha (ou automação) ela veio. Se ele comprar pelo app até 3 dias depois do toque, o pedido conta para ela. O número vem do próprio pedido da Shopify, e não de uma estimativa por horário.',
          'A lista de campanhas mostra a receita de cada uma; o detalhe mostra o caminho do envio à venda (enviados, entregues, aberturas e pedidos); e cada automação mostra o que fez nos últimos 30 dias. A receita depende da Shopify conectada: sem ela, a tela mostra um traço em vez de zero.',
        ],
      },
      {
        titulo: 'Antes de tudo, ligue as notificações',
        paragrafos: [
          'As notificações usam as suas contas da Apple e do Google, então dependem delas conectadas em Publicação. A tela Notificações mostra o que ainda falta, separando o que é com você do que é com a Storefy. Com tudo pronto, o botão "Ligar notificações" deixa a loja pronta para enviar.',
        ],
      },
    ],
  },
  {
    slug: 'analytics',
    titulo: 'Entender os números do Analytics',
    resumo: 'Receita pelo app, fatia do app, aparelhos ativos, instalações e notificações.',
    atalhos: [{ rotulo: 'Abrir Analytics', href: '/analytics' }],
    secoes: [
      {
        titulo: 'Os cartões',
        paragrafos: [
          'Receita pelo app: o que foi vendido em compras feitas dentro do app. Fatia do app: quanto dessa receita representa no total da loja (app mais site). Aparelhos ativos: quantos aparelhos diferentes abriram o app no período. Instalações: quantos aparelhos instalaram o app no período.',
          'Enviadas e abertas: as notificações do período e quantas foram tocadas.',
        ],
      },
      {
        titulo: 'De onde vêm',
        paragrafos: [
          'A receita depende da Shopify conectada: é pelo pedido que a Storefy sabe se a compra foi pelo app ou pelo site. Os números são recalculados de hora em hora, no fuso da loja. Escolha o período (7, 30 ou 90 dias) no topo da tela.',
          'Loja sem app publicado ainda não tem números: a tela diz isso, em vez de mostrar zero.',
        ],
      },
    ],
  },
  {
    slug: 'atualizacao-obrigatoria',
    titulo: 'Atualização obrigatória do app',
    resumo:
      'Quando obrigar os clientes a atualizar — e por que só a versão aprovada pode ser exigida.',
    atalhos: [{ rotulo: 'Abrir o editor do app', href: '/app' }],
    secoes: [
      {
        titulo: 'O que é',
        paragrafos: [
          'Quase tudo no app muda sem atualizar nada: cores, abas, textos e recursos chegam pelo "Publicar" do editor. Só uma versão nova do app em si — gerada em Publicação e aprovada pela Apple e pelo Google — precisa ser baixada na loja de aplicativos.',
          'A atualização obrigatória (editor › Recursos) faz quem estiver com uma versão antiga ver uma tela pedindo para atualizar antes de usar.',
        ],
      },
      {
        titulo: 'Só a versão que já está nas duas lojas',
        paragrafos: [
          'Dá para exigir apenas a versão que a Apple E o Google já aprovaram. Exigir uma versão que ainda não está na loja deixaria seus clientes presos numa tela de "atualize" sem ter o que baixar — por isso o painel nem oferece essa opção.',
          'Use com cuidado: quem não puder atualizar fica sem o app até atualizar.',
        ],
      },
    ],
  },
  {
    slug: 'equipe-e-papeis',
    titulo: 'Equipe, papéis e convites',
    resumo: 'Como convidar pessoas, o que cada papel pode e como sair de uma empresa.',
    atalhos: [{ rotulo: 'Abrir Equipe', href: '/configuracoes/equipe' }],
    secoes: [
      {
        titulo: 'Os papéis',
        paragrafos: [
          'Proprietário: tudo, inclusive excluir lojas e a empresa e cuidar da equipe. Administrador: cria e edita lojas, o app, as notificações e as integrações. Membro: só vê.',
        ],
      },
      {
        titulo: 'Convidar alguém',
        paragrafos: [
          'Em Configurações › Equipe, o proprietário informa o e-mail e o papel. A pessoa recebe um link que vale por 7 dias e só funciona para aquele e-mail — sem conta, ela cria a conta pelo próprio link. Se o e-mail não chegar, reenvie: o link anterior deixa de valer.',
          'Para ter outro proprietário, convide como administrador e mude o papel depois que a pessoa entrar.',
        ],
      },
      {
        titulo: 'Sair e excluir a conta',
        paragrafos: [
          'Qualquer pessoa sai de uma empresa em Configurações › Equipe — menos o único proprietário, que antes torna outra pessoa proprietária. Em Minha conta dá para excluir a conta: a tela mostra antes o que acontece com cada empresa.',
        ],
      },
    ],
  },
];

export function artigoPorSlug(slug: string): Artigo | null {
  return ARTIGOS.find((artigo) => artigo.slug === slug) ?? null;
}

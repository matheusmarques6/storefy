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
          'A lista de verificação da tela Publicação diz o que ainda falta. Com tudo pronto, "Publicar" gera o app (leva de 15 a 30 minutos) e o envia para a sua conta: na Apple, para a App Store Connect; no Google, para o teste interno do Play Console. O andamento aparece na própria tela.',
        ],
      },
      {
        titulo: 'O último passo é seu',
        paragrafos: [
          'As lojas de aplicativos exigem que o dono da conta mande o app para a revisão. Quando for a sua vez, a tela Publicação mostra "Falta um passo seu", com o passo a passo e o botão que abre o lugar certo.',
          'Na Apple: na App Store Connect, escolha o build que a Storefy enviou, complete a ficha (capturas, textos e política de privacidade), responda o questionário "Privacidade do app" e clique em "Enviar para a revisão do app". Numa atualização, cada versão precisa existir lá com o mesmo número do build.',
          'No Google: a primeira vez, termine as tarefas de "Configurar o app" e a página da loja no Play Console. Depois, em "Produção", crie uma versão, adicione o build da biblioteca e envie para a revisão. Toda versão nova chega sozinha ao teste interno, e vai para os clientes quando você a publica em produção.',
          'Os textos da ficha e o endereço da política de privacidade estão prontos em Publicação, para copiar.',
        ],
      },
      {
        titulo: 'A revisão',
        paragrafos: [
          'A Apple e o Google revisam todo app novo e toda versão nova. Costuma levar de algumas horas a alguns dias. A tela Publicação acompanha sozinha, de hora em hora, e quando sair o resultado avisamos por e-mail os proprietários e administradores (dá para desligar em Configurações › Empresa).',
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
    slug: 'blocos-no-tema-da-shopify',
    titulo: 'O banner “baixe o app” e o botão “Me avise” no seu site',
    resumo:
      'Os dois blocos da Storefy no tema da Shopify: como ligar cada um e quando eles aparecem para o cliente.',
    atalhos: [
      { rotulo: 'Abrir o editor do app', href: '/app' },
      { rotulo: 'Automações', href: '/push/automacoes' },
    ],
    secoes: [
      {
        titulo: 'Antes de tudo',
        paragrafos: [
          'Os blocos da Storefy chegam ao tema da sua loja quando ela é conectada pelo botão "Conectar com a Shopify", em Integrações. Depois, cada um é ligado uma vez só no editor de tema da Shopify.',
        ],
      },
      {
        titulo: 'O banner “baixe o app”',
        paragrafos: [
          'Uma faixa no site convidando quem entra pelo celular a baixar o app. Ligue em editor › Recursos › Banner “baixe o app”, escreva o texto (a faixa mostra até 90 caracteres) e publique.',
          'Na Shopify, uma vez só: em Loja virtual › Temas › Personalizar, abra o ícone de apps na barra da esquerda, ligue o "Banner do app", da Storefy, e salve. Depois disso o texto e os links vêm do painel: mudou e publicou, o site mostra em cerca de um minuto.',
          'A faixa só aparece com o app numa loja de aplicativos, e só com o link da loja em que ele já está. Ela aparece no celular — no iPhone, é a faixa da própria Apple; no Android, uma barra embaixo com "Baixar" —, nunca dentro do app, e some por 30 dias para quem fechar.',
        ],
      },
      {
        titulo: 'O botão “Me avise quando voltar”',
        paragrafos: [
          'Na página de um produto esgotado, o cliente toca no botão e recebe uma notificação quando o produto voltar. O botão aparece só dentro do app — no site ele fica escondido — e só quando a variante escolhida está esgotada.',
          'O aviso sai pela automação "De volta ao estoque": ligue-a em Notificações › Automações. É pela Shopify que a Storefy sabe que o estoque voltou.',
        ],
        passos: [
          'Em Loja virtual › Temas › Personalizar, abra o modelo de página de produto.',
          'Na seção de informações do produto, toque em "Adicionar bloco" e escolha "Avise-me quando voltar", da Storefy — de preferência logo abaixo do botão de comprar.',
          'Se quiser, mude os textos do botão e das mensagens nas configurações do bloco, e salve.',
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
          'Enviar agora pede confirmação e diz para quantos aparelhos vai. Agendar usa o horário da loja — o fuso fica na página da loja, em Lojas. Antes de mandar para todo mundo, use o envio de teste no seu celular (o guia "Testar a notificação no seu celular" mostra como adicioná-lo).',
          'Uma campanha salva como rascunho não sai para ninguém até você enviar ou agendar.',
        ],
      },
      {
        titulo: 'Automações',
        paragrafos: [
          'Boas-vindas: para quem instala o app e aceita notificações. Carrinho abandonado: para quem deixou produto no carrinho — cancelada sozinha se a compra acontecer antes, e no máximo um lembrete por dia para a mesma pessoa. De volta ao estoque: para quem pediu para ser avisado de um produto. Pedido enviado: quando você marca o pedido como enviado na Shopify. Sentimos sua falta: para quem passa 7 dias sem abrir o app, no horário que você escolher — cancelada se a pessoa voltar antes. Klaviyo, Omnisend e outras ferramentas: quando um fluxo da sua ferramenta de marketing chama o endereço da automação (há um guia só dela).',
          'Desligar uma automação cancela o que ainda estava na fila: ligar de novo semanas depois não manda um lembrete antigo.',
          'Para não acordar ninguém, as automações não disparam entre 22h e 8h no horário da loja: ficam para as 8h. As campanhas saem na hora que você escolher.',
        ],
      },
      {
        titulo: 'Quanto cada notificação vendeu',
        paragrafos: [
          'Quando o cliente toca numa notificação, o app guarda de qual campanha (ou automação) ela veio. Se ele comprar pelo app até 3 dias depois do toque, o pedido conta para ela. O número vem do próprio pedido da Shopify, e não de uma estimativa por horário.',
          'A lista de campanhas mostra a receita de cada uma; o detalhe mostra o caminho do envio à venda (enviados, entregues, aberturas e pedidos). Cada automação mostra o que fez nos últimos 30 dias, e "Ver detalhes" abre o caminho do envio às vendas no período e o que não saiu, com o motivo. A receita depende da Shopify conectada: sem ela, a tela mostra um traço em vez de zero.',
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
    slug: 'celular-de-teste',
    titulo: 'Testar a notificação no seu celular antes de enviar',
    resumo:
      'Adicione o seu celular como celular de teste e veja a notificação chegar antes de mandar para todo mundo.',
    atalhos: [{ rotulo: 'Nova campanha', href: '/push/nova' }],
    secoes: [
      {
        titulo: 'Por que testar',
        paragrafos: [
          'Uma campanha não tem desfazer. No seu celular você vê o que o formulário não mostra: o texto cortado, o emoji que não aparece, o link que abre no lugar errado.',
          'O teste vai só para os celulares que você adicionou — nunca para um cliente — e não conta como campanha.',
        ],
      },
      {
        titulo: 'Adicionar o seu celular',
        paragrafos: [
          'Você precisa do app da sua loja instalado no celular: é por ele que o teste chega.',
        ],
        passos: [
          'Em Notificações › Nova campanha, desça até "Envio de teste" e toque em "Adicionar celular".',
          'Dê um nome para reconhecer depois, como "Celular da Ana".',
          'Aponte a câmera do celular para o código que aparece e toque no link. O código vale por 10 minutos; se vencer, o painel oferece outro.',
          'O link abre o app da loja, que confirma o celular. O painel percebe sozinho e fecha a janela.',
        ],
      },
      {
        titulo: 'Enviar o teste',
        paragrafos: [
          'Escreva a campanha, escolha o celular na lista do "Envio de teste" e toque em "Enviar teste". Se o celular ainda não recebe notificações, a lista avisa: abra o app nele e permita as notificações.',
          'Para tirar um celular da lista, toque na lixeira ao lado dele. O app continua instalado, e você pode adicioná-lo de novo quando quiser.',
        ],
      },
    ],
  },
  {
    slug: 'klaviyo-omnisend-e-outras-ferramentas',
    titulo: 'Push nos fluxos do Klaviyo, Omnisend, n8n e Zapier',
    resumo:
      'Faça o fluxo da sua ferramenta de marketing avisar também pelo app quem tem o app instalado.',
    atalhos: [{ rotulo: 'Automações', href: '/push/automacoes' }],
    secoes: [
      {
        titulo: 'Como funciona',
        paragrafos: [
          'A automação "Klaviyo, Omnisend e outras ferramentas" dá um endereço para a sua ferramenta chamar. Quando o fluxo chama, a Storefy manda a notificação para o cliente: o mesmo gatilho que manda o e-mail avisa pelo app.',
          'Recebe quem tem o app instalado, com as notificações ligadas, e já entrou na própria conta pelo app. Quem não tem continua recebendo só o e-mail. Como nas outras automações, uma chamada entre 22h e 8h espera as 8h, no horário da loja.',
        ],
      },
      {
        titulo: 'Conectar a sua ferramenta',
        paragrafos: [],
        passos: [
          'Em Notificações › Automações, no card "Klaviyo, Omnisend e outras ferramentas", ligue a automação.',
          'Toque em "Gerar chave" e guarde a chave: por segurança, ela aparece uma vez só.',
          'No fluxo da ferramenta, adicione uma ação de webhook com o método POST, o endereço do card e o cabeçalho Authorization: Bearer seguido da chave. Se a ferramenta não deixar pôr cabeçalho, some ?token= e a chave ao fim do endereço.',
          'No corpo, diga quem recebe: o email do cliente (a Storefy acha o cliente na sua Shopify), o customerId ou uma lista customerIds, com até 50 clientes.',
        ],
      },
      {
        titulo: 'O que mais dá para mandar',
        paragrafos: [
          'title (até 120 caracteres) e body (até 400) trocam o texto da notificação; sem eles, vai o texto da automação. deepLink é a página da loja que o toque abre, e id é o id do evento — com ele, uma chamada repetida não vira duas notificações.',
          'A resposta diz o que aconteceu: 202 com quantos aparelhos vão receber; 401 para a chave errada ou desativada; 403 para a automação desligada; 422 quando não deu para achar o cliente pelo e-mail, com o que fazer.',
        ],
      },
      {
        titulo: 'Trocar ou desativar a chave',
        paragrafos: [
          '"Gerar chave nova" troca a chave na hora: a antiga para de funcionar, então troque na ferramenta logo em seguida. "Desativar chave" faz toda chamada voltar recusada até você gerar outra. Só proprietários e administradores mexem na chave.',
        ],
      },
    ],
  },
  {
    slug: 'boas-vindas-e-permissao',
    titulo: 'Telas de boas-vindas e o pedido de notificação',
    resumo:
      'O que o cliente vê na primeira vez que abre o app, e quando o app pede para mandar notificações.',
    atalhos: [{ rotulo: 'Abrir o editor do app', href: '/app' }],
    secoes: [
      {
        titulo: 'As telas de boas-vindas',
        paragrafos: [
          'Em editor › Recursos, "Adicionar tela" cria até 4 telas que aparecem uma vez só, na primeira abertura do app. Cada uma tem título (até 40 caracteres), texto (até 160) e, se quiser, uma imagem. O cliente pode pular desde a primeira. Sem nenhuma tela, o app abre direto na loja.',
          'A imagem é enviada por "Enviar imagem": JPG, PNG ou WebP, até 8 MB — o ideal é 1080 × 720. A Storefy reduz e prepara a imagem para o celular; uma imagem com fundo transparente continua transparente, sobre a cor de fundo do app.',
          'Ao mexer numa tela, a prévia ao lado mostra essa tela como o app vai mostrar. Ela também aparece na vista "Boas-vindas" da prévia.',
        ],
      },
      {
        titulo: 'Quando o app pede para mandar notificações',
        paragrafos: [
          'O iPhone mostra o pedido de permissão uma vez só: quem toca em "Não permitir" só volta atrás pelos ajustes do celular. Por isso, antes do pedido do sistema, o app mostra uma tela explicando o que o cliente vai receber.',
          'Essa tela lista as promoções e os avisos das automações que você deixou ligadas — o lembrete do carrinho, o pedido enviado e o produto de volta ao estoque —, e só os que conseguem sair: o pedido enviado e o estoque dependem da Shopify conectada. Ligou ou desligou uma automação? A tela acompanha, sem publicar nada.',
          'Em editor › Recursos, "Quando pedir permissão de notificações" escolhe o momento: nas primeiras aberturas do app (a partir da segunda: na primeira, o cliente ainda está conhecendo a loja), depois do primeiro item no carrinho, ou só quando uma página da loja pedir.',
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
          'Enviadas e abertas: as notificações do período — campanhas e automações — e quantas foram tocadas.',
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
    slug: 'varias-lojas',
    titulo: 'Várias lojas: criar, trocar e excluir',
    resumo:
      'Cada loja da empresa tem o próprio app. Veja como criar outra, escolher em qual você está mexendo e excluir.',
    atalhos: [{ rotulo: 'Abrir Lojas', href: '/lojas' }],
    secoes: [
      {
        titulo: 'Cada loja, um app',
        paragrafos: [
          'Cada loja cadastrada vira um app próprio, com editor, notificações, publicação e números separados. As contas da Apple e do Google, a equipe e o plano são da empresa, e valem para todas as lojas.',
        ],
      },
      {
        titulo: 'Criar outra loja',
        paragrafos: [
          'Em Lojas › Nova loja, cole o endereço do site e toque em "Ler loja" para a Storefy buscar o nome e a plataforma. A loja nova passa a ser a loja em uso e abre o começo guiado. Proprietários e administradores criam lojas; o plano pode limitar quantas.',
        ],
      },
      {
        titulo: 'Trocar de loja',
        paragrafos: [
          'O seletor no topo do painel mostra a loja em uso. Tudo o que você vê e muda — o editor, as notificações, a publicação, os números — é da loja escolhida ali.',
        ],
      },
      {
        titulo: 'Excluir uma loja',
        paragrafos: [
          'Só o proprietário exclui, na página da loja, em "Excluir loja". O app dessa loja e tudo o que é dele — configurações, versões, aparelhos, campanhas, automações e números — são apagados, e a Shopify para de mandar os pedidos dela para a Storefy. Não dá para desfazer.',
          'Excluir aqui não tira o app da App Store nem do Google Play: quem já instalou continua com ele, mas o app para de receber a configuração, as notificações e as correções. Tire o app das lojas pelo App Store Connect e pelo Play Console. Os chamados da Ajuda continuam, sem a loja.',
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
  {
    slug: 'plano-e-cobranca',
    titulo: 'Plano, teste grátis e faturas',
    resumo:
      'Como funcionam o teste de 14 dias, a assinatura, os limites do plano e o que acontece com uma fatura em atraso.',
    atalhos: [{ rotulo: 'Abrir Plano e cobrança', href: '/configuracoes/plano' }],
    secoes: [
      {
        titulo: 'O teste grátis',
        paragrafos: [
          'A empresa começa com 14 dias de teste, com tudo liberado. Sete dias antes do fim, uma faixa no topo do painel avisa quanto falta. Assine antes do fim para nada parar.',
        ],
      },
      {
        titulo: 'Assinar',
        paragrafos: [
          'Só o proprietário da empresa assina, troca de plano ou cancela. Em Configurações › Plano e cobrança, escolha o plano e toque em "Assinar". Informe o nome ou a razão social, o CPF ou CNPJ e o e-mail que recebe as faturas.',
          'A cobrança é mensal, pela Asaas: a fatura chega por e-mail e pode ser paga por Pix, boleto ou cartão. A primeira vence no fim do teste — assinar antes não encurta o teste.',
        ],
      },
      {
        titulo: 'Os limites do plano',
        paragrafos: [
          'Cada plano diz quantas lojas, quantos aparelhos ativos (os que abriram o app nos últimos 30 dias) e quantas campanhas por mês cabem nele. As automações não contam como campanha. A página mostra quanto de cada limite está em uso.',
          'Passou dos aparelhos? O app continua funcionando, e a página sugere mudar de plano. Uma loja ou uma campanha além do limite espera a troca de plano — a campanha também pode ser agendada para o mês seguinte.',
        ],
      },
      {
        titulo: 'Se uma fatura atrasar',
        paragrafos: [
          'Depois do vencimento, há 7 dias para pagar sem nada parar; a faixa no topo mostra até quando. Passado o prazo, param o envio de campanhas, a publicação de mudanças no app, as versões novas para as lojas de aplicativos e as lojas novas. O app continua funcionando para os seus clientes, e as automações seguem saindo.',
          'Pague pelo botão "Pagar a fatura", em Plano e cobrança. Tudo volta quando a Asaas confirmar o pagamento.',
          'Já pagou e continua travado? Toque em "Já paguei, conferir", ao lado do botão de pagar: o painel pergunta direto à Asaas. O Pix costuma cair em minutos; o boleto, em até 3 dias úteis.',
        ],
      },
      {
        titulo: 'Trocar de plano ou cancelar',
        paragrafos: [
          '"Mudar para este plano" troca na hora: os limites mudam imediatamente, e o novo valor vale a partir da fatura em aberto.',
          '"Cancelar assinatura" não gera fatura nova e cancela a que está em aberto. O que já foi pago vale até o fim do período; depois disso, param as mesmas coisas de uma fatura atrasada, sem os 7 dias. Dá para assinar de novo quando quiser.',
        ],
      },
      {
        titulo: 'Faturas e dados de cobrança',
        paragrafos: [
          'O proprietário e os administradores veem as faturas, com "Pagar" ou "Ver" em cada uma, e quem paga. O proprietário troca o nome, o documento ou o e-mail das próximas faturas em "Alterar dados de cobrança" — o documento é digitado de novo, porque o painel guarda só os quatro últimos números.',
        ],
      },
    ],
  },
];

export function artigoPorSlug(slug: string): Artigo | null {
  return ARTIGOS.find((artigo) => artigo.slug === slug) ?? null;
}

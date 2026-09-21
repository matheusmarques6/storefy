/**
 * A política de privacidade de cada loja (seção 7 do plano).
 *
 * A Apple e o Google EXIGEM uma URL pública de política de privacidade para
 * publicar. O lojista médio não tem uma, e mandá-lo "arrumar uma" é o ponto em
 * que a publicação para por semanas.
 *
 * O TEXTO É MONTADO A PARTIR DO QUE O APP FAZ DE VERDADE, não de um modelo
 * genérico: se a loja não ligou o push, a seção de notificações não existe; se
 * não há eventos de carrinho, não há o parágrafo que os descreve. Uma política
 * que promete menos do que o app faz é um problema jurídico do lojista; uma
 * que descreve coisas que o app não faz é uma mentira que o revisor da Apple
 * às vezes pega.
 *
 * É função pura de propósito: a mesma montagem serve a página pública e
 * qualquer prévia no painel, e duas montagens divergiriam.
 */

export interface DadosDaPolitica {
  nomeDaLoja: string;
  urlDaLoja: string;
  /** Contato de atendimento. `null` quando o lojista ainda não preencheu. */
  emailDeContato: string | null;
  /** O app manda notificações? */
  pushLigado: boolean;
  /** O app registra eventos de carrinho para o abandono? */
  eventosDeCarrinho: boolean;
  /** Data da última alteração, em ISO. */
  atualizadaEm: string;
}

export interface Secao {
  titulo: string;
  paragrafos: readonly string[];
}

export interface Politica {
  titulo: string;
  atualizadaEm: string;
  secoes: readonly Secao[];
}

export function montarPolitica(dados: DadosDaPolitica): Politica {
  const loja = dados.nomeDaLoja.trim() === '' ? 'esta loja' : dados.nomeDaLoja.trim();
  const secoes: Secao[] = [];

  secoes.push({
    titulo: 'Quem somos',
    paragrafos: [
      `Este aplicativo é o app oficial da ${loja} e mostra a loja que fica em ${dados.urlDaLoja}. A ${loja} é a responsável pelos dados tratados aqui.`,
      'O app foi criado com a Storefy, que atua como operadora: a Storefy trata dados por conta e ordem da loja, e não os usa para finalidade própria.',
    ],
  });

  /*
   * A seção mais importante para o revisor da Apple: o que acontece DENTRO da
   * loja é da loja. O app é uma janela para o site dela, e a compra acontece
   * lá — não aqui.
   */
  secoes.push({
    titulo: 'O que acontece quando você navega e compra',
    paragrafos: [
      `A navegação, o carrinho e a finalização da compra acontecem no site da ${loja}, dentro do app. Os dados que você informa ali — cadastro, endereço, pagamento — são tratados pela loja e pelos serviços que ela usa, seguindo a política do site.`,
      'O aplicativo não guarda cópia dos seus dados de cadastro nem dos seus dados de pagamento.',
    ],
  });

  const coletados: string[] = [
    'Um identificador do aparelho gerado pelo próprio app, que não é o número do seu celular nem o identificador de publicidade.',
    'O modelo do aparelho, a versão do sistema e a versão do app, para o suporte conseguir reproduzir um problema.',
  ];

  if (dados.pushLigado) {
    coletados.push(
      'Um código de inscrição em notificações, criado quando você aceita recebê-las, para o envio das mensagens.',
    );
  }
  if (dados.eventosDeCarrinho) {
    coletados.push(
      'A ocorrência de itens adicionados ao carrinho e a quantidade deles, para lembrar você de um carrinho deixado pela metade.',
    );
  }

  secoes.push({
    titulo: 'O que o aplicativo coleta',
    paragrafos: [
      'Além do que você informa no site da loja, o aplicativo em si registra:',
      ...coletados.map((item) => `• ${item}`),
      'O aplicativo não acessa sua localização, sua câmera, seus contatos, seu microfone nem seus arquivos.',
    ],
  });

  if (dados.pushLigado) {
    secoes.push({
      titulo: 'Notificações',
      paragrafos: [
        `A ${loja} pode enviar notificações sobre pedidos, novidades e promoções. Elas só chegam se você aceitar quando o app perguntar.`,
        'O envio é feito pela OneSignal, que recebe apenas o código de inscrição do aparelho e o conteúdo da mensagem.',
        'Para parar de receber, desligue as notificações do app nos ajustes do seu celular. Isso não afeta suas compras.',
      ],
    });
  }

  secoes.push({
    titulo: 'Com quem os dados são compartilhados',
    paragrafos: [
      'Os dados do aplicativo ficam guardados na Supabase, em servidores no Brasil, e são acessados apenas pela loja e pela equipe da Storefy quando é preciso dar suporte.',
      dados.pushLigado
        ? 'O envio de notificações usa a OneSignal, e a distribuição do app usa a App Store (Apple) e a Google Play (Google).'
        : 'A distribuição do app usa a App Store (Apple) e a Google Play (Google).',
      'Nenhum dado é vendido nem cedido para publicidade de terceiros.',
    ],
  });

  secoes.push({
    titulo: 'Por quanto tempo guardamos',
    paragrafos: [
      'Os dados do aparelho ficam guardados enquanto o app estiver instalado e por até 12 meses depois do último uso.',
      'Os dados de compra seguem o prazo da política do site da loja e as obrigações legais dela.',
    ],
  });

  secoes.push({
    titulo: 'Seus direitos',
    paragrafos: [
      'Você pode pedir a confirmação, o acesso, a correção ou a exclusão dos seus dados, e também revogar o consentimento das notificações, a qualquer momento.',
      /*
       * Sem contato preenchido, o texto NÃO inventa um endereço: diz a
       * verdade, que o canal é o site da loja. Um e-mail inventado numa
       * política de privacidade é pior do que um canal indireto.
       */
      dados.emailDeContato === null || dados.emailDeContato.trim() === ''
        ? `Para exercer esses direitos, fale com a ${loja} pelos canais de atendimento do site ${dados.urlDaLoja}.`
        : `Para exercer esses direitos, escreva para ${dados.emailDeContato.trim()}.`,
      'Desinstalar o app interrompe qualquer coleta feita por ele.',
    ],
  });

  secoes.push({
    titulo: 'Crianças',
    paragrafos: [
      'Este aplicativo não é destinado a menores de 13 anos e não coleta dados deles de forma consciente.',
    ],
  });

  secoes.push({
    titulo: 'Mudanças nesta política',
    paragrafos: [
      'Quando esta política mudar, a data de atualização no topo muda junto. Vale a pena conferir de vez em quando.',
    ],
  });

  return {
    titulo: `Política de Privacidade — ${loja}`,
    atualizadaEm: formatarData(dados.atualizadaEm),
    secoes,
  };
}

/** Data em pt-BR. Data inválida vira vazio, nunca "Invalid Date" na tela. */
export function formatarData(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  });
}

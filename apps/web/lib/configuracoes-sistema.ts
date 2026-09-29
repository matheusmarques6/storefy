/**
 * A13 — o que o deploy tem configurado, e o que quebra sem cada peça.
 *
 * ESTA TELA EXISTE POR CAUSA DE UM PREJUÍZO REAL. `NEXT_PUBLIC_SITE_URL` foi
 * colada sem o `https://`, e o efeito não foi um erro na tela: foi o OAuth da
 * Shopify recusando o retorno e os webhooks sendo registrados errado EM
 * SILÊNCIO — a loja conectava e nenhum pedido chegava. Levou dias para
 * aparecer, e o que faltava era alguém poder olhar numa tela e ver o estado de
 * cada integração.
 *
 * O QUE A LISTA GUARDA NÃO É O VALOR, é o nome e a CONSEQUÊNCIA. Saber que
 * uma chave falta não ajuda um atacante; saber qual é ela, sim — então daqui
 * só sai booleano. E a consequência é o que transforma "ONESIGNAL_ORG_API_KEY
 * ausente" em "nenhum push sai", que é a frase que faz alguém agir.
 *
 * A LISTA NÃO PODE ENVELHECER, e é por isso que existe um teste que varre o
 * código atrás de `process.env.X` e falha quando acha uma variável que não
 * está aqui. A seção 12 do plano já envelheceu desse jeito — perdeu seis
 * variáveis, entre elas justamente a do `https://`.
 */

export interface Integracao {
  chave: string;
  nome: string;
  /** Os nomes das variáveis. Só nomes: valor nenhum passa por aqui. */
  variaveis: string[];
  /** O que para de funcionar sem ela, em pt-BR e concreto. */
  oQueQuebra: string;
  /**
   * O quanto a falta dela pesa, e a tela separa os três.
   *
   * `essencial`: sem ela o painel não sobe para ninguém. `recurso`: sem ela,
   * uma parte do produto para (o push, a publicação). `opcional`: sem ela
   * NADA para — é uma escolha, como entrar com o Google ou ter domínio
   * próprio. A primeira versão só tinha essencial e o resto, e mostrava as
   * opcionais em "Faltando", com a chave tracejada em vermelho, ao lado de um
   * texto dizendo "Nada quebra". A tela contradizia a si mesma.
   */
  nivel: NivelDaIntegracao;
}

export type NivelDaIntegracao = 'essencial' | 'recurso' | 'opcional';

export const INTEGRACOES: Integracao[] = [
  {
    chave: 'supabase',
    nome: 'Supabase',
    variaveis: [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ],
    oQueQuebra: 'Ninguém entra no painel. É o banco, a autenticação e o armazenamento.',
    nivel: 'essencial',
  },
  {
    chave: 'cripto',
    nome: 'Chave de criptografia',
    variaveis: ['ENCRYPTION_KEY'],
    oQueQuebra:
      'As credenciais dos clientes (Shopify, Apple, Google) não são lidas nem gravadas. Trocar esta chave torna ilegível tudo que já foi guardado.',
    nivel: 'essencial',
  },
  {
    chave: 'site',
    nome: 'Endereço do site',
    variaveis: ['NEXT_PUBLIC_SITE_URL'],
    oQueQuebra:
      'O OAuth da Shopify é recusado e os webhooks são registrados com endereço errado, sem avisar. Precisa começar com https://.',
    nivel: 'essencial',
  },
  {
    chave: 'shopify',
    nome: 'App público da Shopify',
    variaveis: ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_SCOPES'],
    oQueQuebra:
      'O botão "Conectar com a Shopify" não aparece, e o webhook responde 503 para a Shopify reentregar depois.',
    nivel: 'recurso',
  },
  {
    chave: 'onesignal',
    nome: 'OneSignal',
    variaveis: ['ONESIGNAL_ORG_API_KEY'],
    oQueQuebra: 'Nenhum push sai: nem campanha, nem carrinho abandonado, nem volta ao estoque.',
    nivel: 'recurso',
  },
  {
    chave: 'build',
    nome: 'Geração de apps',
    variaveis: ['GITHUB_DISPATCH_TOKEN', 'GITHUB_REPO', 'BUILD_API_SECRET', 'EAS_WEBHOOK_SECRET'],
    oQueQuebra:
      'Nenhum cliente consegue publicar: o build não é disparado, e a EAS não consegue avisar quando termina.',
    nivel: 'recurso',
  },
  {
    chave: 'cron',
    nome: 'Segredo dos jobs',
    variaveis: ['CRON_SECRET'],
    oQueQuebra:
      'Os quatro jobs agendados recusam a própria Vercel: push não é despachado, e os números do painel param de ser recalculados.',
    nivel: 'recurso',
  },
  {
    chave: 'email',
    nome: 'E-mail',
    variaveis: ['RESEND_API_KEY', 'EMAIL_REMETENTE'],
    oQueQuebra: 'Convites e avisos por e-mail não são enviados.',
    nivel: 'recurso',
  },
  {
    chave: 'cobranca',
    nome: 'Cobrança (Asaas)',
    variaveis: ['ASAAS_API_KEY', 'ASAAS_WEBHOOK_TOKEN'],
    oQueQuebra:
      'Sem a chave, o lojista vê os planos mas não assina pelo painel. Sem o token, os pagamentos não chegam e a assinatura não fica em dia sozinha.',
    nivel: 'recurso',
  },
  {
    chave: 'asaas_sandbox',
    nome: 'Endereço da Asaas',
    variaveis: ['ASAAS_API_URL'],
    oQueQuebra:
      'Nada quebra: sem ele, a cobrança fala com a Asaas de produção. O endereço do sandbox é só para testar.',
    nivel: 'opcional',
  },
  {
    chave: 'suporte',
    nome: 'Caixa do suporte',
    variaveis: ['EMAIL_SUPORTE'],
    oQueQuebra:
      'Nada quebra: os chamados continuam chegando na tela Chamados do admin. Só o aviso por e-mail de chamado novo não sai.',
    nivel: 'opcional',
  },
  {
    chave: 'erros',
    nome: 'Alerta de erros (Sentry)',
    variaveis: ['SENTRY_DSN'],
    oQueQuebra:
      'Nada quebra para o cliente: os erros do servidor, do painel e do app continuam no log da Vercel. Só ninguém é avisado quando algo falha.',
    nivel: 'opcional',
  },
  {
    chave: 'google',
    nome: 'Entrar com o Google',
    variaveis: ['NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED'],
    oQueQuebra: 'O botão do Google não aparece no login. O e-mail e senha continuam funcionando.',
    nivel: 'opcional',
  },
  {
    chave: 'dominios',
    nome: 'Domínios próprios',
    variaveis: ['NEXT_PUBLIC_CLIENT_HOST', 'NEXT_PUBLIC_ADMIN_HOST'],
    oQueQuebra:
      'Nada quebra: sem eles o painel e o admin convivem no mesmo domínio, o admin em /admin.',
    nivel: 'opcional',
  },
];

export interface IntegracaoConferida extends Integracao {
  /** Todas as variáveis presentes. */
  completa: boolean;
  /** As que faltam, pelo nome. */
  faltando: string[];
}

/**
 * Confere cada integração contra o que o ambiente tem.
 *
 * `presentes` é um mapa de NOME para booleano, montado no servidor. A função
 * nunca vê um valor — é o que permite testá-la sem inventar segredo nenhum, e
 * o que garante que nada vaze para a tela por descuido.
 *
 * Uma integração com três variáveis e duas preenchidas conta como INCOMPLETA,
 * não como meio configurada: na prática ela não funciona, e "2 de 3" na tela
 * daria a impressão de estar quase lá quando está tão parada quanto zero.
 */
export function conferir(presentes: Record<string, boolean>): IntegracaoConferida[] {
  return INTEGRACOES.map((integracao) => {
    const faltando = integracao.variaveis.filter((nome) => presentes[nome] !== true);
    return { ...integracao, completa: faltando.length === 0, faltando };
  });
}

export interface ResumoDaConfiguracao {
  /**
   * Completas entre as que o produto PRECISA — essenciais e de recurso. As
   * opcionais ficam fora da conta: "8 de 10" com as duas opcionais desligadas
   * diria que falta algo quando não falta nada.
   */
  completas: number;
  total: number;
  /** Essenciais faltando. Enquanto for > 0, o produto não funciona. */
  essenciaisFaltando: number;
  /** Opcionais ligadas, só para constar. */
  opcionaisEmUso: number;
}

export function resumo(conferidas: IntegracaoConferida[]): ResumoDaConfiguracao {
  const necessarias = conferidas.filter((i) => i.nivel !== 'opcional');
  return {
    completas: necessarias.filter((i) => i.completa).length,
    total: necessarias.length,
    essenciaisFaltando: conferidas.filter((i) => i.nivel === 'essencial' && !i.completa).length,
    opcionaisEmUso: conferidas.filter((i) => i.nivel === 'opcional' && i.completa).length,
  };
}

/** Todos os nomes de variável que a lista cobre, sem repetição. */
export function variaveisCobertas(): string[] {
  return [...new Set(INTEGRACOES.flatMap((i) => i.variaveis))].sort();
}

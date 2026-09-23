/**
 * Os números da A02, separados em "precisa de você" e "como está a plataforma".
 *
 * A SEPARAÇÃO É O PRODUTO. Dez números lado a lado não são uma visão geral:
 * são dez números, e quem abre a tela de manhã tem que ler todos para
 * descobrir se algum deles pede alguma coisa. Aqui o que pede ação aparece
 * primeiro e só quando existe — zero build com erro não vira um cartão
 * "0 builds com erro", vira ausência, e a seção inteira some dizendo que não
 * há nada pendente.
 *
 * Isso vive fora do componente porque é decisão, não desenho: o que conta como
 * pendência, e o que fazer quando um número vem nulo, dá para provar num teste
 * sem montar uma página.
 */

/** O que a RPC `resumo_do_admin` devolve, com os nulos que o tipo permite. */
export interface ResumoBruto {
  orgs_ativas: number | null;
  orgs_em_trial: number | null;
  trials_vencendo_7d: number | null;
  orgs_inadimplentes: number | null;
  lojas_live: number | null;
  lojas_em_revisao: number | null;
  builds_na_fila: number | null;
  builds_com_erro_7d: number | null;
  builds_rejeitados_7d: number | null;
  contas_dev_com_erro: number | null;
}

export interface NumeroDoResumo {
  chave: string;
  rotulo: string;
  valor: number;
  /** Uma linha dizendo o que o número significa, em pt-BR e sem jargão. */
  ajuda: string;
  /** Para onde a pessoa vai atrás do detalhe. Ausente quando a tela não existe. */
  href?: string;
}

/**
 * Nulo vira zero, e não "—".
 *
 * `count(*)` nunca devolve nulo; o tipo gerado é que permite, porque toda
 * coluna de retorno de função é anulável para o gerador. Tratar como zero é o
 * que corresponde à realidade do banco. O que NÃO pode acontecer é virar
 * `NaN` e aparecer na tela, que é aonde `Number(null)` chegaria sozinho.
 */
function numero(valor: number | null | undefined): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0;
}

/**
 * O que precisa de alguém hoje. Só o que é maior que zero.
 *
 * A ordem é a da urgência, e não a do banco: dinheiro que parou de entrar
 * primeiro, depois o que trava o app de um cliente, depois o que trava o
 * cadastro dele.
 */
export function pendencias(bruto: ResumoBruto): NumeroDoResumo[] {
  const todos: NumeroDoResumo[] = [
    {
      chave: 'inadimplentes',
      rotulo: 'Pagamento atrasado',
      valor: numero(bruto.orgs_inadimplentes),
      ajuda: 'Organizações com cobrança vencida.',
      href: '/admin/organizacoes',
    },
    {
      chave: 'trials_vencendo',
      rotulo: 'Trials acabando',
      valor: numero(bruto.trials_vencendo_7d),
      ajuda: 'Terminam nos próximos 7 dias.',
      href: '/admin/organizacoes',
    },
    {
      chave: 'builds_com_erro',
      rotulo: 'Builds com erro',
      valor: numero(bruto.builds_com_erro_7d),
      ajuda: 'Quebraram nos últimos 7 dias.',
      href: '/admin/builds?filtro=problema',
    },
    {
      chave: 'builds_rejeitados',
      rotulo: 'Rejeitados na loja',
      valor: numero(bruto.builds_rejeitados_7d),
      ajuda: 'Apple ou Google recusaram nos últimos 7 dias.',
      href: '/admin/revisoes',
    },
    {
      chave: 'contas_dev',
      rotulo: 'Contas de desenvolvedor com erro',
      valor: numero(bruto.contas_dev_com_erro),
      ajuda: 'Credencial inválida ou expirada: o cliente não consegue publicar.',
      href: '/admin/contas',
    },
  ];

  return todos.filter((item) => item.valor > 0);
}

/** Como a plataforma está. Aparece sempre, inclusive zerado. */
export function panorama(bruto: ResumoBruto): NumeroDoResumo[] {
  return [
    {
      chave: 'orgs_ativas',
      rotulo: 'Clientes ativos',
      valor: numero(bruto.orgs_ativas),
      ajuda: 'Assinatura em dia.',
      href: '/admin/organizacoes',
    },
    {
      chave: 'orgs_trial',
      rotulo: 'Em teste',
      valor: numero(bruto.orgs_em_trial),
      ajuda: 'Ainda dentro do período de avaliação.',
      href: '/admin/organizacoes',
    },
    {
      chave: 'lojas_live',
      rotulo: 'Apps no ar',
      valor: numero(bruto.lojas_live),
      ajuda: 'Publicados e recebendo usuários.',
      href: '/admin/lojas',
    },
    {
      chave: 'lojas_revisao',
      rotulo: 'Em revisão',
      valor: numero(bruto.lojas_em_revisao),
      ajuda: 'Esperando decisão da Apple ou da Google.',
      href: '/admin/revisoes',
    },
    {
      chave: 'builds_fila',
      rotulo: 'Builds rodando',
      valor: numero(bruto.builds_na_fila),
      ajuda: 'Na fila ou compilando agora.',
      href: '/admin/builds?filtro=andamento',
    },
  ];
}

/**
 * A plataforma ainda não tem nada.
 *
 * Distinto de "tudo em ordem": num painel recém-instalado, dez zeros não
 * significam que está tudo certo — significam que ninguém se cadastrou ainda,
 * e a tela precisa dizer isso em vez de fingir um resumo.
 */
export function plataformaVazia(bruto: ResumoBruto): boolean {
  return (
    numero(bruto.orgs_ativas) === 0 &&
    numero(bruto.orgs_em_trial) === 0 &&
    numero(bruto.orgs_inadimplentes) === 0 &&
    numero(bruto.lojas_live) === 0 &&
    numero(bruto.lojas_em_revisao) === 0
  );
}

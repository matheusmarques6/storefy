/**
 * A03 — os filtros e os rótulos da lista de clientes.
 *
 * Os filtros vivem na URL (a equipe manda o link de "clientes em atraso" para
 * quem vai ligar), então cada um é conferido aqui antes de ir ao banco: o que
 * não é valor conhecido é ignorado, e não vira erro nem consulta estranha.
 */
import type { Database } from '@storefy/db';

type SituacaoDaOrg = Database['public']['Enums']['org_status'];

const SITUACOES: readonly SituacaoDaOrg[] = ['trialing', 'active', 'past_due', 'canceled'];

/** A etapa do começo, pela loja mais adiantada. A ordem é a do caminho. */
export const ETAPAS = ['sem_loja', 'montando', 'publicado', 'enviado', 'no_ar'] as const;
export type Etapa = (typeof ETAPAS)[number];

export const ROTULO_DA_ETAPA: Record<Etapa, string> = {
  sem_loja: 'Sem loja',
  montando: 'Montando o app',
  publicado: 'Publicado no painel',
  enviado: 'Enviado às lojas',
  no_ar: 'No ar',
};

export const SAUDES = ['critica', 'atencao', 'boa'] as const;
export type Saude = (typeof SAUDES)[number];

export const ROTULO_DA_SAUDE: Record<Saude, string> = {
  critica: 'Crítica',
  atencao: 'Atenção',
  boa: 'Boa',
};

/** Cada motivo, dito como a equipe fala ao telefone com o cliente. */
export const ROTULO_DO_MOTIVO: Record<string, string> = {
  cobranca_em_atraso: 'Cobrança em atraso',
  teste_acabou: 'O teste acabou sem assinatura',
  revisao_recusada: 'App recusado na revisão',
  build_com_erro: 'Build com erro nos últimos 7 dias',
  conta_com_erro: 'Conta de desenvolvedor com erro',
  acima_do_limite: 'Mais aparelhos do que o plano permite',
  sem_atividade: 'Ninguém mexe no painel há 30 dias',
};

export function rotuloDoMotivo(codigo: string): string {
  return ROTULO_DO_MOTIVO[codigo] ?? codigo;
}

export interface FiltrosDosClientes {
  situacao?: SituacaoDaOrg;
  /** Um id de plano, ou `teste` para quem ainda não assinou. */
  plano?: string;
  etapa?: Etapa;
  saude?: Saude;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(valor: string | string[] | undefined): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/** Os filtros da URL, só os que o banco sabe responder. */
export function lerFiltros(params: Record<string, string | string[] | undefined>): {
  filtros: FiltrosDosClientes;
  /** Os mesmos, prontos para seguir na busca e na paginação. */
  extras: Record<string, string>;
} {
  const filtros: FiltrosDosClientes = {};

  const situacao = texto(params.situacao);
  if ((SITUACOES as readonly string[]).includes(situacao)) {
    filtros.situacao = situacao as SituacaoDaOrg;
  }

  const plano = texto(params.plano).toLowerCase();
  if (plano === 'teste' || UUID.test(plano)) filtros.plano = plano;

  const etapa = texto(params.etapa);
  if ((ETAPAS as readonly string[]).includes(etapa)) filtros.etapa = etapa as Etapa;

  const saude = texto(params.saude);
  if ((SAUDES as readonly string[]).includes(saude)) filtros.saude = saude as Saude;

  const extras: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(filtros)) {
    if (typeof valor === 'string') extras[chave] = valor;
  }
  return { filtros, extras };
}

/** Algum filtro ligado? Decide entre "nada encontrado" e "nenhum cliente ainda". */
export function temFiltro(filtros: FiltrosDosClientes, busca: string): boolean {
  return busca !== '' || Object.keys(filtros).length > 0;
}

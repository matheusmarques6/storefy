import 'server-only';

/**
 * Busca os números da tela C11.
 *
 * Lê com o client da SESSÃO, e não com a service role: a RLS de
 * `analytics_daily` e de `device_days` já filtra por organização, e usar a
 * service role aqui trocaria uma proteção que o banco garante por um filtro
 * que o código precisa lembrar de fazer — que é como dado vaza entre clientes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import {
  diaNaTimezone,
  janelaDoPeriodo,
  serieCompleta,
  somarPeriodo,
  type DiaDeNumeros,
  type TotaisDoPeriodo,
} from '@/lib/analytics';

type Client = SupabaseClient<Database>;

export interface NumerosDoPeriodo {
  /** Um ponto por dia do período, com os dias parados preenchidos com zero. */
  serie: DiaDeNumeros[];
  totais: TotaisDoPeriodo;
  /**
   * Aparelhos DISTINTOS no período.
   *
   * Vem do banco, e não da soma da série: somar `active_users` daria
   * "aparelho-dias", e quem abre o app todo dia contaria trinta vezes.
   */
  ativosNoPeriodo: number;
  de: string;
  ate: string;
}

export async function numerosDoPeriodo(
  supabase: Client,
  appId: string,
  timezone: string | null,
  dias: number,
  agora = new Date(),
): Promise<NumerosDoPeriodo> {
  const hoje = diaNaTimezone(agora, timezone ?? 'UTC');
  const { de, ate } = janelaDoPeriodo(hoje, dias);

  const [linhas, ativos] = await Promise.all([
    supabase
      .from('analytics_daily')
      .select(
        'day, installs, active_users, sessions, push_sent, push_opened, orders_app, revenue_app_cents, orders_site, revenue_site_cents',
      )
      .eq('app_id', appId)
      .gte('day', de)
      .lte('day', ate)
      .order('day', { ascending: true }),
    supabase.rpc('ativos_no_periodo', { p_app_id: appId, p_de: de, p_ate: ate }),
  ]);

  if (linhas.error != null) {
    throw new Error(`Não foi possível carregar os números: ${linhas.error.message}`);
  }

  const serie = serieCompleta(linhas.data, de, ate);

  return {
    serie,
    // Os totais saem das linhas REAIS, não da série preenchida: os zeros do
    // gráfico não podem entrar na média de ativos e afundá-la.
    totais: somarPeriodo(linhas.data),
    /*
     * Falha na contagem vira zero, e não erro na tela: o resto dos números
     * está de pé, e derrubar a página inteira por causa de um cartão seria
     * trocar um número faltando por uma tela em branco.
     */
    ativosNoPeriodo: ativos.error == null ? ativos.data : 0,
    de,
    ate,
  };
}

/*
 * A08 — o push de todas as lojas, por app.
 *
 * A TELA EXISTE POR DOIS MOTIVOS QUE NÃO SÃO O MESMO. O primeiro é CUSTO: a
 * OneSignal cobra por aparelho ativo no mês, então o app com mais ativos é o
 * que mais pesa na fatura, esteja mandando push ou não. O segundo é FALHA: um
 * app que manda muito e entrega pouco está com credencial ou configuração
 * quebrada, e ninguém descobre isso olhando a tela de um cliente só.
 *
 * `security invoker`, como o `resumo_do_admin`: conferi no `pg_policies` que
 * as oito tabelas lidas aqui terminam a policy de leitura em
 * `or is_platform_admin()`. A RLS continua sendo a fronteira, e não há uma
 * porta paralela que alguém precise lembrar de trancar.
 *
 * O `stats` É JSON VINDO DA ONESIGNAL, e é tratado como hostil: um valor que
 * não seja inteiro vira zero em vez de derrubar a consulta. Um cast direto
 * (`(stats->>'entregues')::bigint`) estoura a query INTEIRA quando um único
 * app tem lixo ali — e aí a tela do admin some por causa de um cliente.
 */
create or replace function public.push_do_admin(p_dias integer default 30)
returns table (
  app_id uuid,
  loja text,
  organizacao text,
  campanhas_enviadas integer,
  campanhas_falhas integer,
  entregues bigint,
  abertos bigint,
  automacoes_enviadas integer,
  automacoes_falhas integer,
  aparelhos integer,
  ativos integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Entre 1 e 365. Um período aberto varreria o histórico inteiro a cada
  -- carregamento da tela, e ninguém pede "os últimos mil dias" de propósito.
  v_dias integer := greatest(1, least(coalesce(p_dias, 30), 365));
  v_desde timestamptz := now() - make_interval(days => v_dias);
begin
  if not public.is_platform_admin() then
    raise exception 'Só o admin da plataforma lê o push global.' using errcode = '42501';
  end if;

  return query
  select
    a.id,
    s.name,
    o.name,
    (select count(*) from public.push_campaigns c
      where c.app_id = a.id and c.status = 'sent' and c.sent_at >= v_desde)::integer,
    (select count(*) from public.push_campaigns c
      where c.app_id = a.id and c.status = 'failed' and c.updated_at >= v_desde)::integer,
    /*
     * A soma vem só das campanhas do período, e o `~ '^[0-9]+$'` é o que
     * impede que um `stats` estranho derrube a tela inteira. `coalesce` no
     * fim porque `sum` de conjunto vazio é nulo, e nulo na tela vira "—"
     * onde o certo é "0". E o `::bigint` no fim porque `sum` sobre bigint
     * devolve NUMERIC — sem o cast o plpgsql recusa a linha, e só na hora de
     * executar: a função é criada sem reclamar e quebra na primeira chamada.
     */
    coalesce((select sum(
        case when c.stats->>'entregues' ~ '^[0-9]+$'
             then (c.stats->>'entregues')::bigint else 0 end)
      from public.push_campaigns c
      where c.app_id = a.id and c.status = 'sent' and c.sent_at >= v_desde), 0)::bigint,
    coalesce((select sum(
        case when c.stats->>'abertos' ~ '^[0-9]+$'
             then (c.stats->>'abertos')::bigint else 0 end)
      from public.push_campaigns c
      where c.app_id = a.id and c.status = 'sent' and c.sent_at >= v_desde), 0)::bigint,
    (select count(*) from public.automation_runs r
      join public.push_automations pa on pa.id = r.automation_id
      where pa.app_id = a.id and r.status = 'sent' and r.sent_at >= v_desde)::integer,
    (select count(*) from public.automation_runs r
      join public.push_automations pa on pa.id = r.automation_id
      where pa.app_id = a.id and r.status = 'failed' and r.created_at >= v_desde)::integer,
    (select count(*) from public.devices d where d.app_id = a.id)::integer,
    /*
     * Ativos é o que a OneSignal cobra, e é DISTINTO de somar `device_days`:
     * quem abre o app todo dia contaria trinta vezes, e a fatura estimada
     * ficaria trinta vezes maior que a real.
     */
    public.ativos_no_periodo(a.id, (v_desde at time zone 'UTC')::date, (now() at time zone 'UTC')::date)
  from public.apps a
  join public.stores s on s.id = a.store_id
  join public.organizations o on o.id = s.org_id
  -- Do que mais custa para o que menos custa: a primeira linha é a que
  -- explica a fatura.
  order by 11 desc, 3 asc;
end
$$;

comment on function public.push_do_admin is
  'A08: push e aparelhos ativos por app, em todas as lojas. Só platform_admin.';

revoke all on function public.push_do_admin(integer) from public, anon;
grant execute on function public.push_do_admin(integer) to authenticated;

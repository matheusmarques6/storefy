-- =============================================================================
-- As colunas que só o servidor grava, nas campanhas e nas automações
-- =============================================================================
--
-- Achado na auditoria de 29/09/2026. O painel grava campanha pela sessão do
-- lojista, e o `authenticated` tinha INSERT e UPDATE em TODAS as colunas —
-- inclusive nas que só o job escreve:
--
--   * `stats` e `sent_at`: a consolidação dos números (`consolidar_analytics`)
--     somava `stats ->> 'enviados'` com um cast direto, numa chamada só para
--     TODAS as lojas. Um lojista que gravasse `{"enviados": "x"}` numa
--     campanha dele parava os números de todos os clientes, a cada hora, sem
--     nada apontando para ele.
--   * `status`: a policy de criação não olhava o status. A campanha criada
--     direto como `sending` escapava da conferência da cobrança (que só olha
--     `scheduled`); 15 minutos depois, `devolver_campanhas_presas` a punha na
--     fila, e a conferência deixa passar quem vem de `sending` — que é o
--     caminho do próprio job. O limite de campanhas do plano, e o bloqueio de
--     quem não pagou, ficavam para trás.
--   * `onesignal_notification_id` e `created_by`: o que o job e a trilha usam
--     para dizer o que saiu e quem fez.
--
-- O conserto segue o desenho das lojas, dos apps e das contas: GRANT por
-- coluna, só do que o painel escreve, e a criação aceitando só rascunho e
-- agendada. `created_by` passa a ser sempre quem pede. E as duas funções que
-- somam `stats` deixam de confiar no formato: o grant fecha a porta, a
-- conferência protege do que já estiver gravado.
-- =============================================================================

-- ------------------------------------------------------------- campanhas

revoke insert, update on public.push_campaigns from anon, authenticated;

grant insert (app_id, title, body, deep_link, image_path, segment, status, scheduled_at)
  on public.push_campaigns to authenticated;
grant update (title, body, deep_link, image_path, segment, status, scheduled_at)
  on public.push_campaigns to authenticated;

drop policy "owner e admin criam campanhas" on public.push_campaigns;

-- Nasce rascunho ou agendada. Enviar, e dizer como foi, é do job.
create policy "owner e admin criam campanhas"
  on public.push_campaigns for insert to authenticated
  with check (
    status in ('draft', 'scheduled')
    and exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner', 'admin']::public.membership_role[])
    )
  );

/*
 * Quem criou é quem pede. Pela sessão, sempre; pela service role (o job, a
 * equipe no servidor), `auth.uid()` é nulo e vale o que o servidor mandou.
 */
create function public.push_campaigns_quem_criou()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;

revoke all on function public.push_campaigns_quem_criou() from public, anon, authenticated;

create trigger push_campaigns_quem_criou
  before insert on public.push_campaigns
  for each row execute function public.push_campaigns_quem_criou();

-- ------------------------------------------------------------- automações

-- `stats` é do servidor. O `upsert` do painel regrava a chave (app_id, type)
-- no ON CONFLICT, por isso as duas entram no UPDATE — e a policy continua
-- exigindo que o app seja de uma loja da pessoa.
revoke insert, update on public.push_automations from anon, authenticated;

grant insert (app_id, type, enabled, delay_minutes, title, body, deep_link)
  on public.push_automations to authenticated;
grant update (app_id, type, enabled, delay_minutes, title, body, deep_link)
  on public.push_automations to authenticated;

-- ------------------------------------------------- contas de desenvolvedor

/*
 * "Verificada" é a palavra da Storefy, dita depois de a Apple ou o Google
 * aceitarem a chave. O painel conecta e desconecta pelo servidor, que confere
 * a chave antes de gravar — mas a sessão ainda podia marcar a própria conta
 * como verificada direto pelo PostgREST, e a A07 e o checklist da publicação
 * acreditariam. Pela sessão, nada mais se escreve aqui.
 */
revoke insert, update on public.developer_accounts from anon, authenticated;

drop policy "owner e admin criam contas de desenvolvedor" on public.developer_accounts;
drop policy "owner e admin editam contas de desenvolvedor" on public.developer_accounts;

-- ------------------------------------------ as somas que confiavam no formato

create or replace function public.consolidar_analytics(p_dias integer DEFAULT 3)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_app record;
  v_dia date;
  v_hoje date;
  v_tz text;
  v_installs integer;
  v_ativos integer;
  v_sessoes integer;
  v_push_enviados integer;
  v_push_abertos integer;
  v_pedidos_app integer;
  v_receita_app bigint;
  v_pedidos_site integer;
  v_receita_site bigint;
  v_escritas integer := 0;
  v_janela integer;
begin
  -- Entre 1 e 90: sem teto, uma chamada com um número grande varreria a tabela
  -- inteira de pedidos de todo mundo e derrubaria o banco no horário do cron.
  v_janela := least(greatest(coalesce(p_dias, 3), 1), 90);

  for v_app in
    select a.id as app_id, coalesce(s.timezone, 'UTC') as tz
      from public.apps a
      join public.stores s on s.id = a.store_id
  loop
    v_tz := v_app.tz;
    v_hoje := (now() at time zone v_tz)::date;

    /*
     * A janela vai até AMANHÃ na loja, e não até hoje. Um dia a mais custa uma
     * varredura vazia; um dia a menos faz o dia corrente de uma loja em
     * Tóquio ou em Kiritimati — que já viraram a data enquanto aqui ainda é
     * ontem — não ser consolidado nunca, e o painel dela mostrar sempre um dia
     * de atraso. É a margem que sobrevive a qualquer engano de fuso aqui.
     */
    for v_dia in
      select generate_series(v_hoje - (v_janela - 1), v_hoje + 1, interval '1 day')::date
    loop
      select count(*) into v_installs
        from public.devices d
       where d.app_id = v_app.app_id
         and (d.created_at at time zone v_tz)::date = v_dia;

      select coalesce(count(*), 0), coalesce(sum(dd.opens), 0)
        into v_ativos, v_sessoes
        from public.device_days dd
       where dd.app_id = v_app.app_id and dd.day = v_dia;

      /*
       * Os números de push vêm de `push_campaigns.stats`, que o job de
       * estatísticas preenche com o que a OneSignal reportou. A coluna nasce
       * `{}`, e é assim que se diz "ainda não sabemos": `stats ->> 'enviados'`
       * é nulo, o `sum` pula a linha e o dia conta zero. Estimar o enviado
       * pela contagem de aparelhos seria inventar número (regra 1).
       */
      /*
       * Só campanha ENVIADA, e só número de verdade: esta função roda numa
       * chamada só para todas as lojas, e um valor fora do formato não pode
       * parar a conta de ninguém. O teto é o do `integer` do dia — e o
       * `coalesce` vem ANTES do `least`, que ignora nulo: `least(null, teto)`
       * daria o teto num dia sem campanha nenhuma.
       */
      select least(coalesce(sum(case when c.stats ->> 'enviados' ~ '^[0-9]{1,9}$'
                                     then (c.stats ->> 'enviados')::integer end), 0),
                   2147483647)::integer,
             least(coalesce(sum(case when c.stats ->> 'abertos' ~ '^[0-9]{1,9}$'
                                     then (c.stats ->> 'abertos')::integer end), 0),
                   2147483647)::integer
        into v_push_enviados, v_push_abertos
        from public.push_campaigns c
       where c.app_id = v_app.app_id
         and c.status = 'sent'
         and c.sent_at is not null
         and (c.sent_at at time zone v_tz)::date = v_dia;

      select coalesce(count(*) filter (where o.source = 'app'), 0),
             coalesce(sum(o.total_cents) filter (where o.source = 'app'), 0),
             coalesce(count(*) filter (where o.source = 'site'), 0),
             coalesce(sum(o.total_cents) filter (where o.source = 'site'), 0)
        into v_pedidos_app, v_receita_app, v_pedidos_site, v_receita_site
        from public.shop_orders o
       where o.app_id = v_app.app_id
         and (o.ordered_at at time zone v_tz)::date = v_dia;

      if v_installs = 0 and v_ativos = 0 and v_sessoes = 0
         and v_push_enviados = 0 and v_push_abertos = 0
         and v_pedidos_app = 0 and v_pedidos_site = 0 then
        -- Nada aconteceu: se havia linha, ela deixou de ser verdade.
        delete from public.analytics_daily
         where app_id = v_app.app_id and day = v_dia;
        continue;
      end if;

      insert into public.analytics_daily (
        app_id, day, installs, active_users, sessions,
        push_sent, push_opened,
        orders_app, revenue_app_cents, orders_site, revenue_site_cents
      )
      values (
        v_app.app_id, v_dia, v_installs, v_ativos, v_sessoes,
        v_push_enviados, v_push_abertos,
        v_pedidos_app, v_receita_app, v_pedidos_site, v_receita_site
      )
      on conflict (app_id, day) do update
        set installs = excluded.installs,
            active_users = excluded.active_users,
            sessions = excluded.sessions,
            push_sent = excluded.push_sent,
            push_opened = excluded.push_opened,
            orders_app = excluded.orders_app,
            revenue_app_cents = excluded.revenue_app_cents,
            orders_site = excluded.orders_site,
            revenue_site_cents = excluded.revenue_site_cents;

      v_escritas := v_escritas + 1;
    end loop;
  end loop;

  return v_escritas;
end;
$function$;

create or replace function public.push_do_admin(p_dias integer DEFAULT 30)
 RETURNS TABLE(app_id uuid, loja text, organizacao text, campanhas_enviadas integer, campanhas_falhas integer, entregues bigint, abertos bigint, automacoes_enviadas integer, automacoes_falhas integer, aparelhos integer, ativos integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
     * A soma vem só das campanhas do período, e o `~ '^[0-9]{1,15}$'` é o que
     * impede que um `stats` estranho derrube a tela inteira. `coalesce` no
     * fim porque `sum` de conjunto vazio é nulo, e nulo na tela vira "—"
     * onde o certo é "0". E o `::bigint` no fim porque `sum` sobre bigint
     * devolve NUMERIC — sem o cast o plpgsql recusa a linha, e só na hora de
     * executar: a função é criada sem reclamar e quebra na primeira chamada.
     */
    coalesce((select sum(
        case when c.stats->>'entregues' ~ '^[0-9]{1,15}$'
             then (c.stats->>'entregues')::bigint else 0 end)
      from public.push_campaigns c
      where c.app_id = a.id and c.status = 'sent' and c.sent_at >= v_desde), 0)::bigint,
    coalesce((select sum(
        case when c.stats->>'abertos' ~ '^[0-9]{1,15}$'
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
$function$;

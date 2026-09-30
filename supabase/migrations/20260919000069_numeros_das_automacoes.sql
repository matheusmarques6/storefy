-- =============================================================================
-- C09, C10 e C11: as aberturas das automações. C07: o total das campanhas.
-- =============================================================================
--
-- Achado na auditoria de 29/09/2026. A automação mostrava só quantas
-- notificações saíram e o que venderam: sem aberturas, sem funil e sem a tela
-- de detalhe (o C10 é "detalhe da campanha/automação"), e fora do C11, que
-- somava só as campanhas. E o C07 lia as 50 campanhas mais novas, somava o
-- "total" só delas e não deixava ver as mais antigas.
--
-- As aberturas de uma campanha vêm da OneSignal: uma notificação, uma
-- consulta. As de uma automação não podem vir de lá — cada envio é uma
-- notificação, e perguntar por cada uma não cabe na cota de ninguém. Quem
-- conta é o app: o despachante põe o id do envio nos dados da notificação, e
-- o app, quando o cliente toca, avisa a Storefy (`POST /api/public/push-opened`).
-- Pelo mesmo motivo, "entregues" de automação a OneSignal só diria uma a uma:
-- o funil da automação começa em "enviadas".
-- =============================================================================

-- ------------------------------------------------ a abertura de cada envio

alter table public.automation_runs add column opened_at timestamptz;

comment on column public.automation_runs.opened_at is
  'Quando o cliente tocou na notificação deste envio, como o app contou. Nulo: não tocou, ou o app ainda não conta.';

/*
 * O app conta a abertura de um envio de automação.
 *
 * Só a service role chama, depois de a rota pública conferir a assinatura do
 * app. O id do envio é aleatório e só viaja dentro da notificação: quem o tem
 * é o celular que a recebeu. Conta uma vez só — tocar de novo não soma.
 *
 * Devolve `contada` (agora ou antes), `desconhecido` (não é um envio já feito
 * por este app) ou `limitado`.
 */
create function public.registrar_abertura_do_envio(p_app_id uuid, p_envio uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Folgado: uma automação manda para muita gente de uma vez, e cada toque chega aqui.
  if not public.consumir_limite('abertura:' || p_app_id::text, 3000, 60) then
    return 'limitado';
  end if;

  update public.automation_runs r
     set opened_at = now()
    from public.push_automations a
   where r.id = p_envio
     and a.id = r.automation_id
     and a.app_id = p_app_id
     and r.status = 'sent'
     and r.opened_at is null;
  if found then
    return 'contada';
  end if;

  -- O mesmo toque chegando duas vezes: já está contado, e não é erro.
  if exists (
    select 1
      from public.automation_runs r
      join public.push_automations a on a.id = r.automation_id
     where r.id = p_envio and a.app_id = p_app_id and r.status = 'sent'
  ) then
    return 'contada';
  end if;

  return 'desconhecido';
end;
$$;

revoke all on function public.registrar_abertura_do_envio(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_abertura_do_envio(uuid, uuid) to service_role;

-- ------------------------------------------------ o resultado de cada automação

-- O retorno ganha uma coluna, e o Postgres não troca o retorno no lugar.
drop function public.resultado_das_automacoes(uuid, integer);

create function public.resultado_das_automacoes(p_app_id uuid, p_dias integer default 30)
returns table (
  automacao_id uuid,
  envios integer,
  aberturas integer,
  pedidos integer,
  receita_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with janela as (
    select now() - make_interval(days => greatest(least(coalesce(p_dias, 30), 365), 1)) as desde
  )
  select a.id,
         (select count(*)::integer
            from public.automation_runs r, janela j
           where r.automation_id = a.id and r.status = 'sent' and r.sent_at >= j.desde),
         (select count(*)::integer
            from public.automation_runs r, janela j
           where r.automation_id = a.id and r.status = 'sent' and r.sent_at >= j.desde
             and r.opened_at is not null),
         (select count(*)::integer
            from public.shop_orders o, janela j
           where o.push_automation_id = a.id and o.ordered_at >= j.desde),
         (select coalesce(sum(o.total_cents), 0)::bigint
            from public.shop_orders o, janela j
           where o.push_automation_id = a.id and o.ordered_at >= j.desde)
    from public.push_automations a
   where a.app_id = p_app_id;
$$;

comment on function public.resultado_das_automacoes(uuid, integer) is
  'C09/C10: envios, aberturas, pedidos e receita de cada automação na janela. Pela RLS das tabelas.';

revoke all on function public.resultado_das_automacoes(uuid, integer) from public, anon;
grant execute on function public.resultado_das_automacoes(uuid, integer) to authenticated, service_role;

/*
 * O app desta loja já conta as aberturas?
 *
 * O app antigo não avisa o toque, e as aberturas dele seriam sempre zero. Um
 * zero ali diria ao lojista que ninguém abre — até o primeiro toque contado,
 * a tela mostra traço e diz que o número chega com a versão nova do app.
 */
create function public.app_conta_aberturas(p_app_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.automation_runs r
      join public.push_automations a on a.id = r.automation_id
     where a.app_id = p_app_id and r.opened_at is not null
  );
$$;

-- Sem ele, a pergunta varreria todos os envios da loja enquanto nenhum abriu.
create index automation_runs_abertos_idx
  on public.automation_runs (automation_id)
  where opened_at is not null;

revoke all on function public.app_conta_aberturas(uuid) from public, anon;
grant execute on function public.app_conta_aberturas(uuid) to authenticated, service_role;

/*
 * O que aconteceu com os envios que NÃO saíram (C10 da automação).
 *
 * Os agendados, os cancelados e os que falharam, com o motivo. É o que
 * responde "por que meu cliente não recebeu": comprou antes, esvaziou o
 * carrinho, já tinha recebido um hoje. Nada do cliente sai daqui — só
 * contagens.
 */
create function public.desfechos_da_automacao(p_automacao_id uuid, p_dias integer default 30)
returns table (situacao public.automation_run_status, motivo text, quantos integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.status, r.canceled_reason, count(*)::integer
    from public.automation_runs r
   where r.automation_id = p_automacao_id
     and r.status <> 'sent'
     and r.scheduled_for >= now() - make_interval(days => greatest(least(coalesce(p_dias, 30), 365), 1))
   group by r.status, r.canceled_reason
   order by 3 desc, 1, 2;
$$;

revoke all on function public.desfechos_da_automacao(uuid, integer) from public, anon;
grant execute on function public.desfechos_da_automacao(uuid, integer) to authenticated, service_role;

-- Os desfechos de uma automação na janela, sem varrer os envios de todo mundo.
create index automation_runs_agenda_idx
  on public.automation_runs (automation_id, scheduled_for);

-- ------------------------------------------------ desligar cancela o que está na fila

/*
 * Achado junto, olhando o que não sai: desligar uma automação só a tirava do
 * despacho. O que já estava agendado ficava na fila e saía de uma vez quando
 * o lojista a ligasse de novo — um "seu pedido foi enviado" ou um "bem-vindo"
 * semanas depois. Agora desligar cancela o que ainda não saiu, com o motivo
 * (o C10 da automação mostra). O que o despacho já pegou segue: está sendo
 * enviado neste minuto.
 */
create function public.cancelar_envios_da_automacao_desligada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.automation_runs
     set status = 'canceled', canceled_reason = 'automação desligada'
   where automation_id = new.id
     and status = 'scheduled'
     and claimed_at is null;
  return new;
end;
$$;

revoke all on function public.cancelar_envios_da_automacao_desligada()
  from public, anon, authenticated;

create trigger push_automations_desligada
  after update of enabled on public.push_automations
  for each row
  when (old.enabled and not new.enabled)
  execute function public.cancelar_envios_da_automacao_desligada();

-- O que já estava parado numa automação desligada sai da fila agora.
update public.automation_runs r
   set status = 'canceled', canceled_reason = 'automação desligada'
  from public.push_automations a
 where a.id = r.automation_id
   and not a.enabled
   and r.status = 'scheduled'
   and r.claimed_at is null;

-- ------------------------------------------------ o total das campanhas (C07)

/*
 * O resumo do topo do C07, de TODAS as campanhas do app.
 *
 * A tela somava as 50 que lia — o total de uma loja com 60 campanhas estava
 * errado, e a lista não mostrava as mais antigas. `entregues` é nulo quando
 * nenhuma campanha tem o número ainda: a tela mostra traço, e não zero. Só
 * número de verdade entra na soma, como na consolidação.
 */
create function public.resumo_das_campanhas(p_app_id uuid)
returns table (enviadas integer, entregues bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*) filter (where c.status = 'sent')::integer,
         sum(case when c.status = 'sent' and c.stats ->> 'entregues' ~ '^[0-9]{1,12}$'
                  then (c.stats ->> 'entregues')::bigint end)::bigint
    from public.push_campaigns c
   where c.app_id = p_app_id;
$$;

revoke all on function public.resumo_das_campanhas(uuid) from public, anon;
grant execute on function public.resumo_das_campanhas(uuid) to authenticated, service_role;

-- ------------------------------------------------ o C11 soma as automações

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

      /*
       * As automações (C11): cada envio é um aparelho, e a abertura é a que o
       * app contou. Pelo intervalo do dia no fuso da loja, e não pela data de
       * cada linha: `automation_runs` é a tabela que mais cresce do push, e o
       * intervalo usa o índice dos enviados.
       */
      select least(v_push_enviados::bigint + count(*), 2147483647)::integer,
             least(v_push_abertos::bigint + count(*) filter (where r.opened_at is not null),
                   2147483647)::integer
        into v_push_enviados, v_push_abertos
        from public.automation_runs r
        join public.push_automations a on a.id = r.automation_id
       where a.app_id = v_app.app_id
         and r.status = 'sent'
         and r.sent_at >= (v_dia::timestamp at time zone v_tz)
         and r.sent_at < ((v_dia + 1)::timestamp at time zone v_tz);

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

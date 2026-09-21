-- De onde vêm os números da tela C11 (fase 5 do plano).
--
-- O PROBLEMA QUE ESTA MIGRATION RESOLVE: `devices.last_seen_at` é UMA coluna.
-- Ela diz quando o aparelho apareceu pela última vez, e só. Contar "quantos
-- aparelhos estiveram ativos na terça" olhando para ela dá o número certo
-- enquanto é terça e um número errado na quarta — porque quem abriu o app nos
-- dois dias só aparece no último. O erro é sempre para baixo, cresce com o
-- tempo e ninguém percebe olhando a tela.
--
-- Guardar um registro por abertura resolveria e cresceria sem limite: um app
-- com dez mil usuários gera milhões de linhas por mês para alimentar dois
-- números. `device_days` é o meio-termo: UMA linha por aparelho por dia, com
-- um contador de aberturas. Dá ativos exatos e sessões exatas, e o tamanho é
-- proporcional a aparelhos ativos, não a aberturas.

create table public.device_days (
  app_id uuid not null references public.apps (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  /** O dia NO FUSO DA LOJA. É o que faz o número bater com o extrato dela. */
  day date not null,
  /** Aberturas do app naquele dia. É o que a tela chama de sessões. */
  opens integer not null default 1,
  primary key (device_id, day)
);

comment on table public.device_days is
  'Uma linha por aparelho por dia, com as aberturas. Alimenta ativos e sessões.';

create index device_days_app_dia_idx on public.device_days (app_id, day);

alter table public.device_days enable row level security;

create policy "membros leem a atividade dos apps da organização"
  on public.device_days for select to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id and public.is_store_member(a.store_id)
    )
    or public.is_platform_admin()
  );

comment on policy "membros leem a atividade dos apps da organização" on public.device_days is
  'Só leitura. Quem escreve é o endpoint do app, com a service role.';

-- --------------------------------------------------- o fuso de cada loja

/**
 * O dia de hoje no fuso da loja deste app.
 *
 * Existe separado porque o fuso errado é o tipo de defeito que ninguém vê: o
 * pedido das 21h de São Paulo cairia no dia seguinte em UTC, e o número do
 * painel ficaria sempre um pouco diferente do extrato da Shopify — perto o
 * bastante para parecer certo e errado o bastante para o lojista não confiar.
 */
create or replace function public.dia_da_loja(p_app_id uuid, p_momento timestamptz default now())
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (p_momento at time zone coalesce(s.timezone, 'UTC'))::date
    from public.apps a
    join public.stores s on s.id = a.store_id
   where a.id = p_app_id;
$$;

comment on function public.dia_da_loja(uuid, timestamptz) is
  'A data no fuso da loja do app. Só service role.';

revoke all on function public.dia_da_loja(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.dia_da_loja(uuid, timestamptz) to service_role;

-- --------------------------------------------- a abertura chega junto com o ping

/**
 * Conta mais uma abertura do app para este aparelho, hoje.
 *
 * Fica numa função separada por um motivo prosaico e real: dentro de
 * `registrar_aparelho`, `device_id` é um parâmetro de SAÍDA, e o
 * `on conflict (device_id, day)` ficaria ambíguo entre a variável e a coluna —
 * o Postgres recusa a função inteira. Separada, a escrita continua na mesma
 * transação de quem chama.
 */
create or replace function public.contar_abertura(p_app_id uuid, p_device_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.device_days (app_id, device_id, day, opens)
  values (p_app_id, p_device_id, public.dia_da_loja(p_app_id), 1)
  on conflict (device_id, day) do update set opens = public.device_days.opens + 1;
$$;

comment on function public.contar_abertura(uuid, uuid) is
  'Soma uma abertura do app ao dia de hoje daquele aparelho. Só service role.';

revoke all on function public.contar_abertura(uuid, uuid) from public, anon, authenticated;
grant execute on function public.contar_abertura(uuid, uuid) to service_role;

/*
 * `registrar_aparelho` ganha o registro do dia.
 *
 * Na mesma função, e não numa chamada separada do servidor, pelo mesmo motivo
 * de `registrar_evento_de_carrinho`: duas idas ao banco podem virar uma só que
 * deu certo e outra que não, e aí o aparelho existe mas o dia dele não — um
 * ativo que some do relatório sem deixar rastro.
 */
create or replace function public.registrar_aparelho(
  p_app_id uuid,
  p_subscription text,
  p_platform public.device_platform,
  p_app_version text default null,
  p_external_id text default null,
  p_email_hash text default null
)
returns table (device_id uuid, limitado boolean, novo boolean, boas_vindas boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_novo boolean;
  v_automacao public.push_automations%rowtype;
  v_fuso text;
  v_boas_vindas boolean := false;
begin
  -- 600 por minuto por app: um app com muitos usuários abrindo ao mesmo tempo
  -- passa; um laço tentando inflar a contagem de instalações, não.
  if not public.consumir_limite('aparelhos:' || p_app_id::text, 600) then
    return query select null::uuid, true, false, false;
    return;
  end if;

  insert into public.devices (
    app_id, onesignal_subscription_id, platform, app_version, external_id,
    customer_email_hash, last_seen_at
  )
  values (
    p_app_id, p_subscription, p_platform, p_app_version, p_external_id,
    p_email_hash, now()
  )
  on conflict (app_id, onesignal_subscription_id) do update
    set app_version = coalesce(excluded.app_version, public.devices.app_version),
        -- O cliente pode sair da conta: `external_id` nulo não apaga o que
        -- havia, mas um valor novo substitui.
        external_id = coalesce(excluded.external_id, public.devices.external_id),
        customer_email_hash = coalesce(
          excluded.customer_email_hash, public.devices.customer_email_hash
        ),
        last_seen_at = now()
  returning id, (xmax = 0) into v_id, v_novo;

  /*
   * A abertura do dia entra AQUI, na mesma transação do aparelho. Numa chamada
   * separada, uma poderia dar certo e a outra não — e o aparelho existiria com
   * o dia dele faltando, um ativo que some do relatório sem deixar rastro.
   */
  perform public.contar_abertura(p_app_id, v_id);

  if v_novo then
    select * into v_automacao
      from public.push_automations
     where app_id = p_app_id and type = 'welcome' and enabled;

    if v_automacao.id is not null then
      select s.timezone into v_fuso
        from public.apps a join public.stores s on s.id = a.store_id
       where a.id = p_app_id;

      -- `on conflict` não serve aqui: não há índice único de (automação,
      -- aparelho), e criar um impediria o carrinho abandonado de ter vários
      -- envios ao longo do tempo. O `not exists` é o guarda certo, e ele é
      -- barato porque `automation_runs_device_idx` cobre a busca.
      if not exists (
        select 1 from public.automation_runs r
         where r.automation_id = v_automacao.id and r.device_id = v_id
      ) then
        insert into public.automation_runs (automation_id, device_id, scheduled_for)
        values (
          v_automacao.id,
          v_id,
          public.fora_do_silencio(
            now() + make_interval(mins => v_automacao.delay_minutes),
            coalesce(v_fuso, 'America/Sao_Paulo')
          )
        );
        v_boas_vindas := true;
      end if;
    end if;
  end if;

  return query select v_id, false, v_novo, v_boas_vindas;
end;
$$;

comment on function public.registrar_aparelho is
  'Upsert do aparelho, com limite por app, boas-vindas e a abertura do dia.';

revoke execute on function public.registrar_aparelho(
  uuid, text, public.device_platform, text, text, text
) from public, anon, authenticated;
grant execute on function public.registrar_aparelho(
  uuid, text, public.device_platform, text, text, text
) to service_role;

-- ---------------------------------------------------- a consolidação do dia

/**
 * Recalcula `analytics_daily` dos últimos dias, para todos os apps.
 *
 * RECALCULA, e não acumula: rodar duas vezes no mesmo dia dá o mesmo
 * resultado, e um job que falhou no meio não deixa número pela metade. É a
 * propriedade que permite chamar de hora em hora sem medo.
 *
 * A janela vai para trás porque o dia de ontem ainda não acabou em todo fuso
 * quando acaba aqui, e porque pedido e abertura chegam atrasados: a Shopify
 * reentrega webhook, e o aparelho sem rede reporta depois.
 *
 * UM DIA SEM NENHUM NÚMERO NÃO VIRA LINHA — e uma linha que zerou é APAGADA.
 * A tela mostra vazio, que é a verdade (regra 1 do CLAUDE.md). Linha de zeros
 * viraria um gráfico com fundo de chão falso, que parece dado.
 */
create or replace function public.consolidar_analytics(p_dias integer default 3)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
      select coalesce(sum((c.stats ->> 'enviados')::integer), 0),
             coalesce(sum((c.stats ->> 'abertos')::integer), 0)
        into v_push_enviados, v_push_abertos
        from public.push_campaigns c
       where c.app_id = v_app.app_id
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
$$;

comment on function public.consolidar_analytics(integer) is
  'Recalcula analytics_daily dos últimos dias, no fuso de cada loja. Só service role.';

revoke all on function public.consolidar_analytics(integer) from public, anon, authenticated;
grant execute on function public.consolidar_analytics(integer) to service_role;

/*
 * `shop/redact` também apaga a atividade dos aparelhos daquela loja.
 *
 * `device_days` não guarda quem é a pessoa, mas guarda o comportamento dela na
 * loja — e a Shopify manda apagar o que veio de lá. Deixar para trás seria
 * atender o webhook pela metade, que é exatamente o que a revisão procura.
 */
create or replace function public.apagar_dados_da_shopify(p_shop_domain text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app uuid;
  v_apagados integer := 0;
  v_parcial integer;
begin
  select a.id into v_app
    from public.stores s
    join public.apps a on a.store_id = s.id
   where s.shop_domain = lower(trim(p_shop_domain))
   limit 1;

  if v_app is null then
    return 0;
  end if;

  delete from public.shop_orders where app_id = v_app;
  get diagnostics v_parcial = row_count;
  v_apagados := v_apagados + v_parcial;

  delete from public.cart_events where app_id = v_app;
  get diagnostics v_parcial = row_count;
  v_apagados := v_apagados + v_parcial;

  delete from public.device_days where app_id = v_app;
  get diagnostics v_parcial = row_count;
  v_apagados := v_apagados + v_parcial;

  /*
   * Os números consolidados também somem: eles são o resumo do que acabou de
   * ser apagado, e manter o resumo de um dado apagado é manter o dado.
   */
  delete from public.analytics_daily where app_id = v_app;
  get diagnostics v_parcial = row_count;
  v_apagados := v_apagados + v_parcial;

  perform public.desconectar_shopify(p_shop_domain);

  return v_apagados;
end;
$$;

comment on function public.apagar_dados_da_shopify is
  'Atende shop/redact: apaga pedidos, carrinho, atividade e números da loja. Só service role.';

revoke all on function public.apagar_dados_da_shopify(text) from public, anon, authenticated;
grant execute on function public.apagar_dados_da_shopify(text) to service_role;

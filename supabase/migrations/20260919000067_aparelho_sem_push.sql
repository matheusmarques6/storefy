-- =============================================================================
-- O aparelho conta nos números, com ou sem push
-- =============================================================================
--
-- Achado na auditoria de 29/09/2026. O aparelho só existia pela inscrição da
-- OneSignal (`devices.onesignal_subscription_id`, obrigatória), e o app só se
-- registrava depois de ligar o push. Mas o push é OPCIONAL na publicação: um
-- app no ar sem push não registrava aparelho nenhum, e o painel mostrava zero
-- instalações, zero ativos e zero sessões (C05, C11) — e zero MAU na cobrança
-- (C15), com a loja usando o app de verdade.
--
-- Agora o app gera, na primeira abertura, um identificador DELE (um UUID
-- aleatório guardado no aparelho — nem o número do celular, nem o
-- identificador de publicidade, como a política de privacidade já dizia), e
-- se registra por ele em toda abertura. A inscrição do push vira um atributo
-- do aparelho: chega quando existir.
--
-- Sem inscrição, o aparelho CONTA mas não RECEBE: as boas-vindas, os inativos
-- e o webhook só agendam push para quem tem inscrição — um envio para
-- ninguém só viraria falha na tela das automações.
-- =============================================================================

alter table public.devices
  add column install_id uuid,
  alter column onesignal_subscription_id drop not null,
  -- Um aparelho sem nenhuma das duas não é aparelho: seria uma linha que nada
  -- acha de novo, contando instalação para sempre.
  add constraint devices_tem_identidade
    check (install_id is not null or onesignal_subscription_id is not null);

comment on column public.devices.install_id is
  'Identificador que o próprio app gera na primeira abertura (UUID aleatório). É por ele que o aparelho conta nos números, com ou sem push.';
comment on column public.devices.onesignal_subscription_id is
  'Inscrição do push na OneSignal. Nula quando o app não tem push, ou antes de o SDK criá-la: o aparelho conta, mas não recebe.';

create unique index devices_app_instalacao_key
  on public.devices (app_id, install_id) where install_id is not null;

-- ------------------------------------------------------------ o registro

drop function public.registrar_aparelho(
  uuid, text, public.device_platform, text, text, text
);

/*
 * A inscrição e a plataforma ganham `default` só para a inscrição poder
 * faltar (app sem push) sem mudar a ordem dos parâmetros — quem chama por
 * posição continua funcionando. A plataforma segue obrigatória, conferida
 * aqui dentro.
 */
create function public.registrar_aparelho(
  p_app_id uuid,
  p_subscription text default null,
  p_platform public.device_platform default null,
  p_app_version text default null,
  p_external_id text default null,
  p_email_hash text default null,
  p_install_id uuid default null
)
returns table (device_id uuid, limitado boolean, novo boolean, boas_vindas boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_novo boolean := false;
  v_inscricao_antes text;
  v_criado_em timestamptz;
  v_automacao public.push_automations%rowtype;
  v_fuso text;
  v_boas_vindas boolean := false;
begin
  if nullif(btrim(coalesce(p_subscription, '')), '') is null and p_install_id is null then
    raise exception 'registrar_aparelho: aparelho sem inscrição e sem instalação'
      using errcode = '22023';
  end if;
  if p_platform is null then
    raise exception 'registrar_aparelho: aparelho sem plataforma' using errcode = '22023';
  end if;

  -- 600 por minuto por app: um app com muitos usuários abrindo ao mesmo tempo
  -- passa; um laço tentando inflar a contagem de instalações, não.
  if not public.consumir_limite('aparelhos:' || p_app_id::text, 600) then
    return query select null::uuid, true, false, false;
    return;
  end if;

  /*
   * Quem é este aparelho. Primeiro pela inscrição, que é o que o identificava
   * antes deste identificador existir — um app antigo atualizado encontra a
   * linha dele, e não vira uma instalação nova. Depois pela instalação.
   */
  if p_subscription is not null then
    select d.id, d.onesignal_subscription_id, d.created_at
      into v_id, v_inscricao_antes, v_criado_em
      from public.devices d
     where d.app_id = p_app_id and d.onesignal_subscription_id = p_subscription
     for update;
  end if;
  if v_id is null and p_install_id is not null then
    select d.id, d.onesignal_subscription_id, d.created_at
      into v_id, v_inscricao_antes, v_criado_em
      from public.devices d
     where d.app_id = p_app_id and d.install_id = p_install_id
     for update;
  end if;

  if v_id is null and p_install_id is null then
    -- O app de antes deste identificador: só a inscrição, como sempre foi.
    insert into public.devices (
      app_id, onesignal_subscription_id, platform, app_version, external_id,
      customer_email_hash, last_seen_at
    )
    values (
      p_app_id, p_subscription, p_platform, p_app_version, p_external_id, p_email_hash, now()
    )
    on conflict (app_id, onesignal_subscription_id) do update
      set last_seen_at = now()
    returning id, (xmax = 0), created_at into v_id, v_novo, v_criado_em;
  elsif v_id is null then
    /*
     * A primeira abertura costuma mandar DUAS chamadas quase juntas: a da
     * abertura e a de quando o push cria a inscrição. A segunda que chegar
     * encontra a linha pela instalação, em vez de falhar no índice único.
     */
    insert into public.devices (
      app_id, install_id, onesignal_subscription_id, platform, app_version, external_id,
      customer_email_hash, last_seen_at
    )
    values (
      p_app_id, p_install_id, p_subscription, p_platform, p_app_version, p_external_id,
      p_email_hash, now()
    )
    on conflict (app_id, install_id) where install_id is not null do update
      set onesignal_subscription_id = coalesce(
            excluded.onesignal_subscription_id, public.devices.onesignal_subscription_id
          ),
          last_seen_at = now()
    returning id, (xmax = 0), created_at into v_id, v_novo, v_criado_em;
  else
    update public.devices d
       set onesignal_subscription_id = coalesce(p_subscription, d.onesignal_subscription_id),
           -- A linha achada pela inscrição ganha a instalação, se nenhuma outra
           -- já a tiver (a de antes do push, que para de ser vista e sai dos ativos).
           install_id = coalesce(
             d.install_id,
             case
               when p_install_id is not null and not exists (
                 select 1 from public.devices o
                  where o.app_id = p_app_id and o.install_id = p_install_id
               ) then p_install_id
             end
           ),
           app_version = coalesce(p_app_version, d.app_version),
           -- O cliente pode sair da conta: `external_id` nulo não apaga o que
           -- havia, mas um valor novo substitui.
           external_id = coalesce(p_external_id, d.external_id),
           customer_email_hash = coalesce(p_email_hash, d.customer_email_hash),
           last_seen_at = now()
     where d.id = v_id;
  end if;

  /*
   * A abertura do dia entra AQUI, na mesma transação do aparelho. Numa chamada
   * separada, uma poderia dar certo e a outra não — e o aparelho existiria com
   * o dia dele faltando, um ativo que some do relatório sem deixar rastro.
   */
  perform public.contar_abertura(p_app_id, v_id);

  /*
   * As boas-vindas vão para quem acabou de chegar E pode receber: quando o
   * aparelho ganha a inscrição pela primeira vez, no primeiro dia dele. Um
   * cliente de meses cujo app só agora ganhou push não é recebido com
   * "bem-vindo".
   */
  if p_subscription is not null and v_inscricao_antes is null
     and v_criado_em > now() - interval '1 day' then
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

comment on function public.registrar_aparelho(
  uuid, text, public.device_platform, text, text, text, uuid
) is
  'Upsert do aparelho pela inscrição do push ou pela instalação, com limite por app, boas-vindas e a abertura do dia.';

revoke execute on function public.registrar_aparelho(
  uuid, text, public.device_platform, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.registrar_aparelho(
  uuid, text, public.device_platform, text, text, text, uuid
) to service_role;

-- ------------------------------------------ push só para quem pode receber

create or replace function public.agendar_pelo_webhook(p_automacao uuid, p_clientes text[], p_titulo text DEFAULT NULL::text, p_corpo text DEFAULT NULL::text, p_link text DEFAULT NULL::text, p_ref text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_pa public.push_automations%rowtype;
  v_fuso text;
  v_ref text := case
    when p_ref is null or btrim(p_ref) = '' then 'webhook'
    else 'webhook:' || left(btrim(p_ref), 100)
  end;
  v_quantos integer := 0;
begin
  select * into v_pa
    from public.push_automations
   where id = p_automacao and type = 'custom_webhook';
  if v_pa.id is null then
    return 0;
  end if;

  update public.automation_webhooks
     set last_received_at = now(), received_count = received_count + 1
   where automation_id = p_automacao;

  if not v_pa.enabled then
    return 0;
  end if;

  select coalesce(s.timezone, 'America/Sao_Paulo') into v_fuso
    from public.apps a join public.stores s on s.id = a.store_id
   where a.id = v_pa.app_id;

  insert into public.automation_runs (
    automation_id, device_id, trigger_ref, scheduled_for, deep_link, title, body
  )
  select v_pa.id,
         aparelho.id,
         v_ref,
         public.fora_do_silencio(now() + make_interval(mins => v_pa.delay_minutes), v_fuso),
         nullif(btrim(coalesce(p_link, '')), ''),
         nullif(btrim(coalesce(p_titulo, '')), ''),
         nullif(btrim(coalesce(p_corpo, '')), '')
    from (
      -- Os aparelhos DESTE app de cada cliente — e poucos POR CLIENTE: um
      -- cliente com vinte celulares é engano, e não motivo para vinte pushes.
      -- O teto é de cada um, e não da chamada: com 50 clientes na mesma
      -- chamada, os últimos não podem ficar sem aviso.
      select por_cliente.id
        from (
          select d.id,
                 row_number() over (
                   partition by d.external_id order by d.last_seen_at desc
                 ) as ordem
            from public.devices d
           where d.app_id = v_pa.app_id
             and d.external_id = any (p_clientes)
             -- Sem inscrição, o aparelho não recebe: o envio viraria falha.
             and d.onesignal_subscription_id is not null
        ) por_cliente
       where por_cliente.ordem <= 10
    ) aparelho
  -- Com `p_ref`, a mesma entrega repetida não agenda de novo — nem quando as
  -- duas chegam ao mesmo tempo, porque quem decide é o índice único.
  on conflict (automation_id, device_id, trigger_ref) where trigger_ref like 'webhook:%'
  do nothing;

  get diagnostics v_quantos = row_count;
  return v_quantos;
end;
$function$;

create or replace function public.agendar_inativos()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v record;
  v_parcial integer;
  v_quantos integer := 0;
begin
  for v in
    select pa.id as automacao,
           pa.app_id,
           pa.delay_minutes,
           coalesce(s.timezone, 'America/Sao_Paulo') as fuso,
           (now() at time zone coalesce(s.timezone, 'America/Sao_Paulo'))::date as hoje
      from public.push_automations pa
      join public.apps a on a.id = pa.app_id
      join public.stores s on s.id = a.store_id
     where pa.type = 'inactive_7d'
       and pa.enabled
  loop
    insert into public.automation_runs (automation_id, device_id, trigger_ref, scheduled_for)
    select v.automacao,
           ultimo.device_id,
           'inativo:' || ultimo.dia::text,
           public.fora_do_silencio(
             ((ultimo.dia + 7)::timestamp at time zone v.fuso)
               + make_interval(mins => v.delay_minutes),
             v.fuso
           )
      from (
        -- O índice (app_id, day) acha quem usou nos dias da janela; o "não
        -- voltou depois" é pela chave (device_id, day).
        select dd.device_id, max(dd.day) as dia
          from public.device_days dd
         where dd.app_id = v.app_id
           and dd.day between v.hoje - 9 and v.hoje - 7
         group by dd.device_id
      ) ultimo
     where not exists (
             select 1 from public.device_days depois
              where depois.device_id = ultimo.device_id
                and depois.day > ultimo.dia
           )
       -- Sem inscrição, o aparelho conta como ativo, mas não recebe push.
       and exists (
             select 1 from public.devices d
              where d.id = ultimo.device_id
                and d.onesignal_subscription_id is not null
           )
       and not exists (
             select 1 from public.automation_runs r
              where r.automation_id = v.automacao
                and r.device_id = ultimo.device_id
                and r.trigger_ref = 'inativo:' || ultimo.dia::text
           );

    get diagnostics v_parcial = row_count;
    v_quantos := v_quantos + v_parcial;
  end loop;

  return v_quantos;
end;
$function$;

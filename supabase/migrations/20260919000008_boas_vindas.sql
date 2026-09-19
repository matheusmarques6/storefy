-- O push de boas-vindas, que nasce junto com o aparelho (seção 6 do plano).
--
-- "O registro do device cria um automation_run agendado para now + delay."
-- Fica aqui, e não no servidor web, pelo mesmo motivo do carrinho abandonado:
-- o aparelho gravado e o envio agendado são a mesma decisão, e separá-los em
-- duas chamadas cria o caso em que uma acontece e a outra não.
--
-- Só na PRIMEIRA vez. Reabrir o app não é instalar de novo, e quem desinstala
-- e reinstala no mesmo aparelho mantém a inscrição do OneSignal — receber
-- "bem-vindo" toda semana é o tipo de coisa que faz desinstalar de vez.

-- A assinatura de saída muda, e o Postgres não troca colunas de retorno com
-- `create or replace`.
drop function if exists public.registrar_aparelho(
  uuid, text, public.device_platform, text, text, text
);

create function public.registrar_aparelho(
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
  'Upsert do aparelho e, na primeira vez, o agendamento do push de boas-vindas.';

revoke execute on function public.registrar_aparelho(uuid, text, public.device_platform, text, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_aparelho(uuid, text, public.device_platform, text, text, text)
  to service_role;

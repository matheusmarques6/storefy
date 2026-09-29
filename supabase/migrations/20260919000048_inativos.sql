-- "Inativo há 7 dias" (C09): o gatilho que faltava.
--
-- O tipo `inactive_7d` existe desde a migration 4, mas nunca teve quem o
-- disparasse — e por isso a tela escondia a automação. O dado para o gatilho
-- já existe: `device_days` guarda, por aparelho, cada dia (no fuso da loja)
-- em que o app foi aberto.
--
-- A regra, em palavras:
--   - quem abriu o app pela última vez há 7 dias recebe UM aviso;
--   - a janela é de 7 a 9 dias, e não só de 7: se o job ficar parado uma
--     hora ou um dia, ninguém fica sem o aviso por isso;
--   - um aviso por período de ausência: o `trigger_ref` guarda o último dia
--     de uso, e quem continua sumido não recebe um por dia;
--   - quem volta ao app antes do envio não recebe (o despacho cancela).
--
-- O horário: o começo do 7º dia no fuso da loja, mais o atraso que o lojista
-- escolheu ("esperar 12 horas" é meio-dia), e a madrugada empurra para as 8h.

-- ------------------------------------------------ o batimento do job novo

alter table public.job_heartbeats drop constraint job_heartbeats_job_check;
alter table public.job_heartbeats add constraint job_heartbeats_job_check
  check (job in ('dispatch-push', 'push-stats', 'review-status', 'analytics', 'inactive-devices'));

-- ------------------------------------------------------------------ agendar

create or replace function public.agendar_inativos()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
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
$$;

comment on function public.agendar_inativos() is
  'Agenda o aviso de quem não abre o app há 7 dias. Só service role, pelo job de hora em hora.';

revoke all on function public.agendar_inativos() from public, anon, authenticated;
grant execute on function public.agendar_inativos() to service_role;

-- ------------------------------------------ o despacho cancela quem voltou

create or replace function public.reservar_envios_de_automacao(p_limite integer default 100)
returns table (
  id uuid,
  automation_id uuid,
  app_id uuid,
  subscription_id text,
  title text,
  body text,
  deep_link text,
  onesignal_app_id text,
  onesignal_api_key_enc text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Fora do silêncio antes de reservar: quem cair na madrugada é adiado e nem
  -- entra na leva deste minuto.
  update public.automation_runs r
     set scheduled_for = public.fora_do_silencio(now(), coalesce(s.timezone, 'America/Sao_Paulo'))
    from public.push_automations pa
    join public.apps a on a.id = pa.app_id
    join public.stores s on s.id = a.store_id
   where r.automation_id = pa.id
     and r.status = 'scheduled'
     and r.scheduled_for <= now()
     and public.fora_do_silencio(now(), coalesce(s.timezone, 'America/Sao_Paulo')) > now();

  -- Carrinho abandonado para quem já recebeu um nas últimas 24 horas: cancela
  -- em vez de enviar. O cliente não precisa de dois lembretes por dia.
  update public.automation_runs r
     set status = 'canceled', canceled_reason = 'já recebeu um push de carrinho hoje'
    from public.push_automations pa
   where r.automation_id = pa.id
     and pa.type = 'abandoned_cart'
     and r.status = 'scheduled'
     and r.scheduled_for <= now()
     and exists (
       select 1 from public.automation_runs outro
        where outro.device_id = r.device_id
          and outro.id <> r.id
          and outro.status = 'sent'
          and outro.sent_at > now() - interval '24 hours'
     );

  -- Quem voltou ao app depois de agendado o aviso de inatividade não está
  -- mais inativo: "sentimos sua falta" para quem abriu o app hoje é ruído.
  update public.automation_runs r
     set status = 'canceled', canceled_reason = 'voltou a abrir o app'
    from public.push_automations pa
   where r.automation_id = pa.id
     and pa.type = 'inactive_7d'
     and r.status = 'scheduled'
     and r.trigger_ref like 'inativo:%'
     and exists (
       select 1 from public.device_days dd
        where dd.device_id = r.device_id
          and dd.day > substr(r.trigger_ref, 9)::date
     );

  return query
  with reservados as (
    update public.automation_runs r
       set claimed_at = now()
     where r.id in (
       select r2.id
         from public.automation_runs r2
         join public.push_automations pa on pa.id = r2.automation_id
        where r2.status = 'scheduled'
          and r2.claimed_at is null
          and r2.scheduled_for <= now()
          -- Automação desligada no meio do caminho não dispara o que ficou.
          and pa.enabled
        order by r2.scheduled_for
        limit greatest(coalesce(p_limite, 100), 1)
        for update skip locked
     )
    returning r.id, r.automation_id, r.device_id, r.deep_link
  )
  select res.id, res.automation_id, pa.app_id, d.onesignal_subscription_id,
         pa.title, pa.body,
         -- O link DO ENVIO vence o da automação: é ele que leva ao produto
         -- que o cliente pediu para acompanhar.
         coalesce(res.deep_link, pa.deep_link),
         a.onesignal_app_id, a.onesignal_api_key_enc
    from reservados res
    join public.push_automations pa on pa.id = res.automation_id
    join public.devices d on d.id = res.device_id
    join public.apps a on a.id = pa.app_id;
end;
$$;

comment on function public.reservar_envios_de_automacao is
  'Reserva os envios vencidos, adiando os da madrugada e cancelando os repetidos e os de quem voltou.';

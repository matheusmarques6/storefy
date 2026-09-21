-- "Avise-me quando voltar" (seção 6 do plano).
--
-- A automação que precisava de um pedido explícito do cliente final para
-- existir. Avisar TODO MUNDO que um produto voltou é spam; avisar quem pediu é
-- a notificação com a maior taxa de abertura que uma loja consegue, porque ela
-- foi pedida.
--
-- O pedido só pode vir de DENTRO DO APP: a inscrição é por aparelho, e um
-- aparelho só existe quando o app está instalado. O botão no site de quem não
-- tem o app não teria para onde mandar a notificação.
--
-- A INSCRIÇÃO É CONSUMIDA no aviso. Ela não vira histórico: quem pediu, foi
-- avisado; se quiser de novo, pede de novo. Guardar o pedido atendido só faria
-- a mesma pessoa receber o mesmo aviso no próximo reabastecimento.

create table public.back_in_stock_subs (
  id uuid primary key default extensions.gen_random_uuid(),
  app_id uuid not null references public.apps (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  /** Id da variante na Shopify. É ela que tem estoque, e não o produto. */
  variant_id text not null,
  /** Para onde a notificação leva. Vem do próprio tema, no momento do pedido. */
  deep_link text,
  created_at timestamptz not null default now()
);

comment on table public.back_in_stock_subs is
  'Quem pediu para ser avisado quando uma variante voltar ao estoque.';

/*
 * Um pedido por aparelho por variante. Sem esta chave, tocar duas vezes no
 * botão viraria duas notificações iguais quando o produto voltasse.
 */
create unique index back_in_stock_subs_unico
  on public.back_in_stock_subs (device_id, variant_id);
create index back_in_stock_subs_variante_idx
  on public.back_in_stock_subs (app_id, variant_id);

alter table public.back_in_stock_subs enable row level security;

create policy "membros leem os avisos pedidos nos apps da organização"
  on public.back_in_stock_subs for select to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id and public.is_store_member(a.store_id)
    )
    or public.is_platform_admin()
  );

comment on policy "membros leem os avisos pedidos nos apps da organização"
  on public.back_in_stock_subs is
  'Só leitura. Quem escreve é o endpoint do app, com a service role.';

-- ------------------------------------------------- o link de cada envio

/*
 * `automation_runs` ganha um link próprio.
 *
 * As outras automações usam o link da automação — um só, escolhido pelo
 * lojista. Esta não pode: "voltou ao estoque" que abre a home da loja obriga o
 * cliente a procurar de novo o produto que ele pediu para acompanhar, e é aí
 * que a notificação vira irritação em vez de venda.
 */
alter table public.automation_runs add column deep_link text;

comment on column public.automation_runs.deep_link is
  'Link deste envio. Quando nulo, vale o link da automação.';

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
  'Reserva os envios vencidos, adiando os da madrugada e cancelando os repetidos.';

-- ------------------------------------------------------------- inscrever

/**
 * Guarda o pedido de aviso de um aparelho para uma variante.
 *
 * Devolve `true` quando o pedido é NOVO. Tocar de novo no botão não vira
 * segundo pedido — e, principalmente, não vira segunda notificação.
 */
create or replace function public.inscrever_de_volta(
  p_app_id uuid,
  p_device_id uuid,
  p_variant_id text,
  p_deep_link text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novo boolean;
begin
  if p_variant_id is null or trim(p_variant_id) = '' then
    return false;
  end if;

  /*
   * O aparelho tem que ser DESTE app. O endpoint já confere a assinatura do
   * app, mas o id do aparelho viaja no corpo — e uma conferência a mais no
   * banco é o que impede um app de inscrever o aparelho de outro.
   */
  if not exists (
    select 1 from public.devices d where d.id = p_device_id and d.app_id = p_app_id
  ) then
    return false;
  end if;

  insert into public.back_in_stock_subs (app_id, device_id, variant_id, deep_link)
  values (p_app_id, p_device_id, trim(p_variant_id), nullif(trim(coalesce(p_deep_link, '')), ''))
  on conflict (device_id, variant_id) do nothing;

  get diagnostics v_novo = row_count;
  return v_novo;
end;
$$;

comment on function public.inscrever_de_volta is
  'Registra o pedido de aviso de volta ao estoque. Só service role.';

revoke all on function public.inscrever_de_volta(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.inscrever_de_volta(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------- avisar

/**
 * Avisa quem pediu, quando a variante volta.
 *
 * Devolve quantos avisos foram agendados. A inscrição é APAGADA junto: ela
 * existia para um aviso, e esse aviso aconteceu.
 *
 * Com a automação desligada, nada é agendado E NADA É APAGADO: os pedidos
 * ficam esperando o lojista ligar. Apagá-los seria perder silenciosamente a
 * intenção de compra de quem pediu.
 */
create or replace function public.avisar_de_volta(p_app_id uuid, p_variant_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_automacao public.push_automations%rowtype;
  v_fuso text;
  v_quantos integer := 0;
begin
  select * into v_automacao
    from public.push_automations
   where app_id = p_app_id and type = 'back_in_stock' and enabled;

  if v_automacao.id is null then
    return 0;
  end if;

  select s.timezone into v_fuso
    from public.apps a join public.stores s on s.id = a.store_id
   where a.id = p_app_id;

  with apagados as (
    delete from public.back_in_stock_subs s
     where s.app_id = p_app_id and s.variant_id = trim(p_variant_id)
    returning s.device_id, s.deep_link
  )
  insert into public.automation_runs (
    automation_id, device_id, trigger_ref, deep_link, scheduled_for
  )
  select v_automacao.id, apagados.device_id, trim(p_variant_id), apagados.deep_link,
         public.fora_do_silencio(
           now() + make_interval(mins => v_automacao.delay_minutes),
           coalesce(v_fuso, 'America/Sao_Paulo')
         )
    from apagados;

  get diagnostics v_quantos = row_count;
  return v_quantos;
end;
$$;

comment on function public.avisar_de_volta(uuid, text) is
  'Avisa e desinscreve quem pediu aviso daquela variante. Só service role.';

revoke all on function public.avisar_de_volta(uuid, text) from public, anon, authenticated;
grant execute on function public.avisar_de_volta(uuid, text) to service_role;

-- --------------------------------------------------------- shop/redact

/*
 * O pedido de aviso é dado de cliente final: ele diz o que aquela pessoa quer
 * comprar. Sai junto no `shop/redact`.
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

  delete from public.back_in_stock_subs where app_id = v_app;
  get diagnostics v_parcial = row_count;
  v_apagados := v_apagados + v_parcial;

  delete from public.analytics_daily where app_id = v_app;
  get diagnostics v_parcial = row_count;
  v_apagados := v_apagados + v_parcial;

  perform public.desconectar_shopify(p_shop_domain);

  return v_apagados;
end;
$$;

comment on function public.apagar_dados_da_shopify is
  'Atende shop/redact: apaga pedidos, carrinho, atividade, avisos e números. Só service role.';

revoke all on function public.apagar_dados_da_shopify(text) from public, anon, authenticated;
grant execute on function public.apagar_dados_da_shopify(text) to service_role;

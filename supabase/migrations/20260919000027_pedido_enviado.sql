-- A automação "pedido enviado" (seção 6 do plano).
--
-- O gatilho é o webhook `fulfillments/create` da Shopify, e o destinatário é o
-- APARELHO QUE FEZ O PEDIDO — descoberto pelo token do carrinho que o app já
-- reportou, e guardado em `shop_orders.device_id` na hora em que o pedido
-- chegou. Sem esse elo, "seu pedido saiu para entrega" iria para a loja
-- inteira, o que é spam e motivo de desinstalação.
--
-- PEDIDO SEM APARELHO NÃO GERA NADA. É o pedido que veio do site: a pessoa não
-- tem o app, não há para onde mandar, e inventar um destinatário seria pior do
-- que não avisar.

create or replace function public.agendar_pedido_enviado(
  p_app_id uuid,
  p_shopify_order_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_automacao public.push_automations%rowtype;
  v_device uuid;
  v_fuso text;
begin
  select * into v_automacao
    from public.push_automations
   where app_id = p_app_id and type = 'order_shipped' and enabled;

  if v_automacao.id is null then
    return false;
  end if;

  select o.device_id into v_device
    from public.shop_orders o
   where o.app_id = p_app_id and o.shopify_order_id = p_shopify_order_id;

  if v_device is null then
    return false;
  end if;

  /*
   * Um aviso por pedido. A Shopify manda `fulfillments/create` uma vez por
   * REMESSA: um pedido com três itens que saem em caixas diferentes gera três
   * webhooks, e sem esta trava o cliente receberia três notificações iguais.
   */
  if exists (
    select 1 from public.automation_runs r
     where r.automation_id = v_automacao.id and r.trigger_ref = p_shopify_order_id
  ) then
    return false;
  end if;

  select s.timezone into v_fuso
    from public.apps a join public.stores s on s.id = a.store_id
   where a.id = p_app_id;

  insert into public.automation_runs (automation_id, device_id, trigger_ref, scheduled_for)
  values (
    v_automacao.id,
    v_device,
    p_shopify_order_id,
    -- Respeita o silêncio noturno como as outras: "seu pedido saiu" às três da
    -- manhã acorda o cliente e não adianta nada.
    public.fora_do_silencio(
      now() + make_interval(mins => v_automacao.delay_minutes),
      coalesce(v_fuso, 'America/Sao_Paulo')
    )
  );

  return true;
end;
$$;

comment on function public.agendar_pedido_enviado(uuid, text) is
  'Agenda o aviso de pedido enviado para o aparelho que fez o pedido. Só service role.';

revoke all on function public.agendar_pedido_enviado(uuid, text) from public, anon, authenticated;
grant execute on function public.agendar_pedido_enviado(uuid, text) to service_role;

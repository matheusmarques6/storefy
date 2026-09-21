-- `registrar_pedido` ganha defaults nos campos que a Shopify nem sempre manda.
--
-- Esta migração já rodou no projeto com a assinatura antiga de
-- `20260919000021`, que exigia número do pedido, moeda e token de carrinho.
-- Sem `default null`, o tipo gerado dizia que esses campos eram obrigatórios —
-- e o painel não compilava ao passar o nulo que a Shopify manda de verdade.
--
-- Num banco novo ela não muda nada: `20260919000021` já cria a assinatura
-- final, o `drop` não encontra a antiga e o corpo abaixo é o mesmo. Ela fica
-- no repositório para o histórico local bater com o do projeto.
drop function if exists public.registrar_pedido(
  uuid, text, text, public.origem_do_pedido, integer, text, text, timestamptz
);

create or replace function public.registrar_pedido(
  p_app_id uuid,
  p_shopify_order_id text,
  p_source public.origem_do_pedido,
  p_total_cents integer,
  p_ordered_at timestamptz,
  p_order_number text default null,
  p_currency text default 'BRL',
  p_cart_token text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device uuid;
  v_novo boolean;
begin
  if p_cart_token is not null and p_cart_token <> '' then
    select c.device_id into v_device
      from public.cart_events c
     where c.app_id = p_app_id and c.cart_token = p_cart_token
     order by c.created_at desc
     limit 1;
  end if;

  insert into public.shop_orders (
    app_id, shopify_order_id, order_number, source,
    total_cents, currency, device_id, cart_token, ordered_at
  )
  values (
    p_app_id, p_shopify_order_id, p_order_number, p_source,
    greatest(coalesce(p_total_cents, 0), 0), coalesce(nullif(p_currency, ''), 'BRL'),
    v_device, nullif(p_cart_token, ''), coalesce(p_ordered_at, now())
  )
  on conflict (app_id, shopify_order_id) do nothing;

  get diagnostics v_novo = row_count;
  return v_novo;
end;
$$;

comment on function public.registrar_pedido is
  'Grava um pedido da Shopify sem duplicar na reentrega. Só service role.';

revoke all on function public.registrar_pedido(
  uuid, text, public.origem_do_pedido, integer, timestamptz, text, text, text
) from public, anon, authenticated;
grant execute on function public.registrar_pedido(
  uuid, text, public.origem_do_pedido, integer, timestamptz, text, text, text
) to service_role;

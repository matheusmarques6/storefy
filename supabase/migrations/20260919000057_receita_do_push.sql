-- C07 e C10: a receita que cada push trouxe.
--
-- "O app me deu quanto de receita a mais" já tinha resposta (migration 21);
-- faltava "e quanto disso veio desta notificação". A corrente é a mesma da
-- marca `_storefy`, com um elo a mais: o despachante põe o id da campanha ou
-- da automação nos dados da notificação; o app, quando o cliente toca, grava
-- `_storefy_push` no carrinho (por três dias); a Shopify leva o atributo até o
-- pedido; e o webhook `orders/create` passa a origem para `registrar_pedido`.

alter table public.shop_orders
  add column push_campaign_id uuid references public.push_campaigns (id) on delete set null,
  add column push_automation_id uuid references public.push_automations (id) on delete set null,
  -- Um toque só leva o crédito: o atributo tem UM valor.
  add constraint shop_orders_um_push_so
    check (push_campaign_id is null or push_automation_id is null),
  -- Quem grava o atributo do push é o app, junto com a marca `_storefy`: a
  -- receita do push é uma parte da receita do app, nunca um número à parte.
  add constraint shop_orders_push_so_do_app
    check ((push_campaign_id is null and push_automation_id is null) or source = 'app');

comment on column public.shop_orders.push_campaign_id is
  'A campanha cuja notificação o cliente tocou nos três dias antes do pedido.';
comment on column public.shop_orders.push_automation_id is
  'A automação cuja notificação o cliente tocou nos três dias antes do pedido.';

create index shop_orders_push_campaign_idx
  on public.shop_orders (push_campaign_id) where push_campaign_id is not null;
create index shop_orders_push_automation_idx
  on public.shop_orders (push_automation_id, ordered_at) where push_automation_id is not null;

/*
 * `registrar_pedido` ganha a origem do push. Ela vem de um atributo de
 * carrinho — que qualquer um escreve com um `fetch` no console da loja —, então
 * a função CONFERE que a campanha (ou a automação) é do mesmo app do pedido.
 * Sem a conferência, um atributo forjado com o id da campanha de outra loja
 * poria receita no painel de outro cliente. Origem que não confere — ou que
 * vem num pedido que não é do app — é descartada: o pedido entra do mesmo
 * jeito, só sem o crédito ao push.
 */
drop function public.registrar_pedido(
  uuid, text, public.origem_do_pedido, integer, timestamptz, text, text, text
);

create function public.registrar_pedido(
  p_app_id uuid,
  p_shopify_order_id text,
  p_source public.origem_do_pedido,
  p_total_cents integer,
  p_ordered_at timestamptz,
  p_order_number text default null,
  p_currency text default 'BRL',
  p_cart_token text default null,
  p_push_campaign_id uuid default null,
  p_push_automation_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device uuid;
  v_novo boolean;
  v_campanha uuid;
  v_automacao uuid;
begin
  if p_cart_token is not null and p_cart_token <> '' then
    select c.device_id into v_device
      from public.cart_events c
     where c.app_id = p_app_id and c.cart_token = p_cart_token
     order by c.created_at desc
     limit 1;
  end if;

  if p_source = 'app' and p_push_campaign_id is not null then
    select c.id into v_campanha
      from public.push_campaigns c
     where c.id = p_push_campaign_id and c.app_id = p_app_id;
  elsif p_source = 'app' and p_push_automation_id is not null then
    select a.id into v_automacao
      from public.push_automations a
     where a.id = p_push_automation_id and a.app_id = p_app_id;
  end if;

  insert into public.shop_orders (
    app_id, shopify_order_id, order_number, source,
    total_cents, currency, device_id, cart_token, ordered_at,
    push_campaign_id, push_automation_id
  )
  values (
    p_app_id, p_shopify_order_id, p_order_number, p_source,
    greatest(coalesce(p_total_cents, 0), 0), coalesce(nullif(p_currency, ''), 'BRL'),
    v_device, nullif(p_cart_token, ''), coalesce(p_ordered_at, now()),
    v_campanha, v_automacao
  )
  on conflict (app_id, shopify_order_id) do nothing;

  get diagnostics v_novo = row_count;
  return v_novo;
end;
$$;

comment on function public.registrar_pedido is
  'Grava um pedido da Shopify sem duplicar na reentrega, com a origem do push conferida. Só service role.';

revoke all on function public.registrar_pedido(
  uuid, text, public.origem_do_pedido, integer, timestamptz, text, text, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.registrar_pedido(
  uuid, text, public.origem_do_pedido, integer, timestamptz, text, text, text, uuid, uuid
) to service_role;

/*
 * Pedidos e receita de cada campanha pedida. `security invoker`: quem soma é
 * a RLS de `shop_orders` — o lojista só soma pedidos das próprias lojas, e
 * uma lista de ids de outra loja volta vazia, e não com a receita alheia.
 * Somado no banco porque uma campanha boa tem milhares de pedidos, e trazer
 * cada um para somar na tela seria o painel lento justo quando dá certo.
 */
create or replace function public.receita_das_campanhas(p_ids uuid[])
returns table (campanha_id uuid, pedidos integer, receita_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.push_campaign_id, count(*)::integer, coalesce(sum(o.total_cents), 0)::bigint
    from public.shop_orders o
   where o.push_campaign_id = any(coalesce(p_ids, array[]::uuid[]))
   group by o.push_campaign_id;
$$;

comment on function public.receita_das_campanhas(uuid[]) is
  'C07/C10: pedidos e receita que cada campanha trouxe. Pela RLS de shop_orders.';

revoke all on function public.receita_das_campanhas(uuid[]) from public, anon;
grant execute on function public.receita_das_campanhas(uuid[]) to authenticated, service_role;

/*
 * As automações de um app nos últimos dias: quantas notificações saíram e
 * quantos pedidos e quanto de receita elas trouxeram. Automação não tem a
 * estatística da OneSignal por envio (cada envio é uma notificação avulsa),
 * então os envios contam pelo que o próprio job registrou.
 */
create or replace function public.resultado_das_automacoes(p_app_id uuid, p_dias integer default 30)
returns table (automacao_id uuid, envios integer, pedidos integer, receita_cents bigint)
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
            from public.shop_orders o, janela j
           where o.push_automation_id = a.id and o.ordered_at >= j.desde),
         (select coalesce(sum(o.total_cents), 0)::bigint
            from public.shop_orders o, janela j
           where o.push_automation_id = a.id and o.ordered_at >= j.desde)
    from public.push_automations a
   where a.app_id = p_app_id;
$$;

comment on function public.resultado_das_automacoes(uuid, integer) is
  'C09/C10: envios, pedidos e receita de cada automação na janela. Pela RLS das tabelas.';

revoke all on function public.resultado_das_automacoes(uuid, integer) from public, anon;
grant execute on function public.resultado_das_automacoes(uuid, integer) to authenticated, service_role;

/*
 * O total que as notificações venderam no período, campanhas e automações
 * juntas: o número do topo da tela de notificações. Somado no banco pelo
 * mesmo motivo da soma por campanha, e pela RLS pelo mesmo motivo também.
 */
create or replace function public.receita_do_push(p_app_id uuid, p_dias integer default 30)
returns table (pedidos integer, receita_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer, coalesce(sum(o.total_cents), 0)::bigint
    from public.shop_orders o
   where o.app_id = p_app_id
     and (o.push_campaign_id is not null or o.push_automation_id is not null)
     and o.ordered_at >= now() - make_interval(days => greatest(least(coalesce(p_dias, 30), 365), 1));
$$;

comment on function public.receita_do_push(uuid, integer) is
  'C07: pedidos e receita de todas as notificações do app na janela. Pela RLS de shop_orders.';

revoke all on function public.receita_do_push(uuid, integer) from public, anon;
grant execute on function public.receita_do_push(uuid, integer) to authenticated, service_role;

-- A contagem de envios de cada automação na janela. Sem este índice, o
-- resultado do C09 varreria `automation_runs` inteira — de todas as lojas —
-- a cada abertura da tela, e é a tabela que mais cresce do push.
create index automation_runs_enviados_idx
  on public.automation_runs (automation_id, sent_at)
  where status = 'sent';

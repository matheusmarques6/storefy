-- Atribuição de pedidos e números diários (fase 5 do plano).
--
-- A PERGUNTA QUE O PRODUTO INTEIRO EXISTE PARA RESPONDER é "o app me deu
-- quanto de receita a mais". Sem atribuição, a resposta é palpite — e um
-- palpite não renova assinatura nenhuma.
--
-- A marca vem do carrinho: o bridge injeta o atributo `_storefy=1` com
-- `/cart/update.js` quando o app abre a loja, a Shopify carrega esse atributo
-- até o pedido, e o webhook `orders/create` o lê. É atribuição pelo dado da
-- própria Shopify, e não por janela de tempo — que erraria toda vez que o
-- cliente abre o app, desiste, e compra pelo site meia hora depois.

create type public.origem_do_pedido as enum ('app', 'site');

comment on type public.origem_do_pedido is
  'De onde veio o pedido, pelo atributo de carrinho que o app injeta.';

create table public.shop_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  app_id uuid not null references public.apps (id) on delete cascade,
  /** Id do pedido na Shopify. É por ele que a reentrega não duplica. */
  shopify_order_id text not null,
  order_number text,
  source public.origem_do_pedido not null,
  total_cents integer not null default 0,
  currency text not null default 'BRL',
  /** Aparelho que fez o pedido, quando o app soube dizer qual. */
  device_id uuid references public.devices (id) on delete set null,
  cart_token text,
  /** Data do pedido no fuso da loja, para o número diário bater com o extrato. */
  ordered_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.shop_orders is
  'Pedidos da Shopify, marcados como vindos do app ou do site.';

/*
 * A Shopify REENTREGA webhook: ela desiste em 5 segundos e tenta de novo, e o
 * mesmo pedido chega duas, três vezes. Sem esta chave, a receita do app
 * apareceria dobrada no painel — e o lojista confiaria no número.
 */
create unique index shop_orders_unico on public.shop_orders (app_id, shopify_order_id);
create index shop_orders_app_data_idx on public.shop_orders (app_id, ordered_at desc);

alter table public.shop_orders enable row level security;

create policy "membros leem os pedidos dos apps da organização"
  on public.shop_orders for select to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id and public.is_store_member(a.store_id)
    )
    or public.is_platform_admin()
  );

comment on policy "membros leem os pedidos dos apps da organização" on public.shop_orders is
  'Só leitura. Quem escreve é o webhook da Shopify, com a service role.';

-- ------------------------------------------------------------- números do dia

/*
 * Uma linha por app por dia.
 *
 * Tabela agregada, e não `count(*)` na hora: a tela C11 mostra 90 dias, e
 * varrer `devices` e `shop_orders` inteiros a cada carregamento fica caro
 * exatamente quando o cliente cresce — o momento em que ele menos pode ver o
 * painel lento.
 *
 * TODA COLUNA COMEÇA EM ZERO E SÓ SOBE COM DADO REAL. Um dia sem número não
 * vira linha: a tela mostra vazio, que é a verdade (regra 1 do CLAUDE.md).
 */
create table public.analytics_daily (
  app_id uuid not null references public.apps (id) on delete cascade,
  day date not null,
  installs integer not null default 0,
  active_users integer not null default 0,
  sessions integer not null default 0,
  push_sent integer not null default 0,
  push_opened integer not null default 0,
  orders_app integer not null default 0,
  revenue_app_cents bigint not null default 0,
  orders_site integer not null default 0,
  revenue_site_cents bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (app_id, day)
);

comment on table public.analytics_daily is
  'Números por app e por dia, calculados por job. A tela C11 lê daqui.';

create trigger analytics_daily_set_updated_at
  before update on public.analytics_daily
  for each row execute function public.set_updated_at();

alter table public.analytics_daily enable row level security;

create policy "membros leem os números dos apps da organização"
  on public.analytics_daily for select to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id and public.is_store_member(a.store_id)
    )
    or public.is_platform_admin()
  );

comment on policy "membros leem os números dos apps da organização" on public.analytics_daily is
  'Só leitura. Quem escreve é o job diário, com a service role.';

-- --------------------------------------------------------- escrita do webhook

/*
 * Grava um pedido, sem duplicar.
 *
 * Devolve `true` só quando a linha é NOVA. A Shopify reentrega o mesmo pedido
 * várias vezes, e é esse booleano que impede a receita de aparecer dobrada.
 */
create or replace function public.registrar_pedido(
  p_app_id uuid,
  p_shopify_order_id text,
  p_source public.origem_do_pedido,
  p_total_cents integer,
  p_ordered_at timestamptz,
  -- Nulos de verdade: a Shopify nem sempre manda número do pedido nem token
  -- de carrinho, e `default null` é o que deixa o tipo gerado dizer isso.
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
  /*
   * O aparelho é descoberto pelo token do carrinho, que o app já reportou em
   * `cart_events`. É o que liga o pedido ao aparelho sem o app precisar mandar
   * nada no momento da compra — ele nem está aberto quando o webhook chega.
   */
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

/*
 * Encontra o app de uma loja pelo domínio da Shopify.
 *
 * O webhook chega com `x-shopify-shop-domain` e mais nada nosso. Sem esta
 * função, a rota precisaria de duas idas ao banco e de ler `stores`, que é
 * cheia de coluna com segredo.
 */
create or replace function public.app_da_loja_shopify(p_shop_domain text)
returns table (app_id uuid, store_id uuid, timezone text)
language sql
security definer
set search_path = ''
as $$
  select a.id, s.id, s.timezone
    from public.stores s
    join public.apps a on a.store_id = s.id
   where s.shop_domain = lower(trim(p_shop_domain))
   limit 1;
$$;

comment on function public.app_da_loja_shopify(text) is
  'Acha o app pelo domínio .myshopify.com. Só service role.';

revoke all on function public.app_da_loja_shopify(text) from public, anon, authenticated;
grant execute on function public.app_da_loja_shopify(text) to service_role;

/*
 * Desconecta a loja quando o app é desinstalado.
 *
 * O token deixa de valer no instante da desinstalação, e guardá-lo seria
 * guardar um segredo morto. Os escopos somem junto para a tela dizer
 * "desconectada" em vez de "conectada com token que não funciona".
 */
create or replace function public.desconectar_shopify(p_shop_domain text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linhas integer;
begin
  update public.stores
     set shopify_access_token_enc = null,
         shopify_scopes = null
   where shop_domain = lower(trim(p_shop_domain));

  get diagnostics v_linhas = row_count;
  return v_linhas > 0;
end;
$$;

comment on function public.desconectar_shopify(text) is
  'Apaga o token da loja quando o app Shopify é desinstalado. Só service role.';

revoke all on function public.desconectar_shopify(text) from public, anon, authenticated;
grant execute on function public.desconectar_shopify(text) to service_role;

/*
 * Apaga os dados de uma loja (webhook `shop/redact` da Shopify).
 *
 * A Shopify manda este webhook 48 horas depois da desinstalação, e atendê-lo
 * é OBRIGATÓRIO: é o que a lei de privacidade exige e o que a revisão do app
 * confere. Não é uma formalidade que dá para deixar para depois.
 *
 * O que some é o que veio da Shopify — pedidos e eventos de carrinho. A loja e
 * o app continuam, porque o lojista pode reinstalar amanhã e porque a trilha
 * de auditoria não é dado de cliente final.
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

  perform public.desconectar_shopify(p_shop_domain);

  return v_apagados;
end;
$$;

comment on function public.apagar_dados_da_shopify(text) is
  'Atende shop/redact: apaga pedidos e eventos de carrinho da loja. Só service role.';

revoke all on function public.apagar_dados_da_shopify(text) from public, anon, authenticated;
grant execute on function public.apagar_dados_da_shopify(text) to service_role;

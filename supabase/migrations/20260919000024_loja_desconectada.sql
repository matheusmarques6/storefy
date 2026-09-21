-- Loja desconectada não recebe mais pedido.
--
-- `desconectar_shopify` apaga o token, mas o `shop_domain` FICA: ele também é
-- o domínio que o app libera na WebView, e apagá-lo mudaria o comportamento do
-- aplicativo por causa de um botão de integração. Só que `app_da_loja_shopify`
-- procurava a loja só pelo domínio — então um webhook que a Shopify ainda
-- mandasse depois da desconexão continuaria virando pedido atribuído, e o
-- lojista que desligou a integração veria a receita subir sozinha.
--
-- O token passa a ser parte da pergunta. Os webhooks de privacidade não
-- dependem desta função: eles são tratados antes de procurar o app, porque
-- precisam funcionar justamente para quem já saiu.
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
     and s.shopify_access_token_enc is not null
   limit 1;
$$;

comment on function public.app_da_loja_shopify(text) is
  'Acha o app pelo domínio .myshopify.com, só enquanto a loja está conectada. Só service role.';

revoke all on function public.app_da_loja_shopify(text) from public, anon, authenticated;
grant execute on function public.app_da_loja_shopify(text) to service_role;
